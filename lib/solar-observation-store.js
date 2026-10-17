'use strict';

// This module has local filesystem access only. Never pass it a transport/client.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const io = fs.promises;
const KiB = 1024;
const LIMITS = Object.freeze({ queueBytes: 128 * KiB, queueRecords: 256, recordBytes: 32 * KiB,
  diskBytes: 32 * 1024 * KiB, files: 2048, modelBytes: 32 * KiB, flushMs: 300000 });
const POLICIES = Object.freeze({ minute: { bytes: 10 * 1024 * KiB, age: 7 * 86400000 },
  aggregate: { bytes: 6 * 1024 * KiB, age: 180 * 86400000 },
  forecast: { bytes: 12 * 1024 * KiB, age: 28 * 86400000 } });
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const dataName = /^(minute|aggregate|forecast)-(\d{13})-([a-f0-9]{12})\.ndjson$/;
const metadata = new Set(['model.json', 'model.prev.json', 'model.tmp', 'reset.json', 'reset.tmp']);
const finite = n => typeof n === 'number' && Number.isFinite(n);
const activeDirectories = new Set();

class ObservationStore {
  constructor({ directory, now = Date.now, onFault = () => {}, onLoss = () => {}, limits = {}, fsImpl = io }) {
    this.directory = path.resolve(directory); this.now = now; this.io = fsImpl; this.claimed = false;
    this.limits = { ...LIMITS, ...limits }; this.onFault = onFault; this.onLoss = onLoss;
    this.queue = []; this.queueBytes = 0; this.files = new Map(); this.bytes = 0;
    this.dataFiles = new Map(); this.categoryBytes = { minute: 0, aggregate: 0, forecast: 0 }; this.nextSweepAt = 0;
    this.ready = false; this.closed = false; this.busy = null; this.retryAt = 0;
    this.sequence = 0; this.dropped = 0; this.faults = 0;
  }

  async readSmall(name) {
    const file = await this.io.open(path.join(this.directory, name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > this.limits.modelBytes) throw new Error('invalid observation metadata size/type');
      const bytes = Buffer.alloc(stat.size + 1);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      if (bytesRead > stat.size) throw new Error('observation metadata changed while reading');
      return JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
    } finally { await file.close(); }
  }

  async init(resetKey = '') {
    if (activeDirectories.has(this.directory)) { this.reportFault(); return null; }
    activeDirectories.add(this.directory); this.claimed = true;
    try {
      await this.io.mkdir(this.directory, { recursive: true, mode: 0o700 });
      const dir = await this.io.lstat(this.directory);
      if (!dir.isDirectory() || dir.isSymbolicLink()) throw new Error('observation directory must be a real local directory');
      await this.io.chmod(this.directory, 0o700);
      // Streaming directory enumeration prevents an externally enlarged directory becoming an array in RAM.
      const entries = await this.io.opendir(this.directory);
      for await (const entry of entries) {
        if (this.files.size >= this.limits.files) throw new Error('observation file count exceeded');
        if (!dataName.test(entry.name) && !metadata.has(entry.name)) throw new Error('unexpected file in observation directory');
        const stat = await this.io.lstat(path.join(this.directory, entry.name));
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('observation files must be regular local files');
        const max = dataName.test(entry.name) ? this.limits.recordBytes : this.limits.modelBytes;
        if (stat.size > max) throw new Error('oversized observation file');
        this.track(entry.name, stat.size);
      }
      // Establish chronological eviction once at startup. Normal writes append in receipt order.
      this.dataFiles = new Map([...this.dataFiles].sort((a, b) => a[1].stamp - b[1].stamp));
      if (this.bytes > this.limits.diskBytes) throw new Error('observation directory exceeds quota');
      let reset = null;
      try { reset = await this.readSmall('reset.json'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      const requested = resetKey ? hash(resetKey.slice(0, 64)) : null;
      if ((requested && requested !== reset?.key) || reset?.pending === true) {
        const key = requested || reset.key;
        await this.atomic('reset', { key, pending: true });
        for (const name of [...this.files.keys()]) if (name !== 'reset.json') await this.remove(name);
        await this.atomic('reset', { key, pending: false });
      }
      // Incomplete snapshots never replace the last committed model.
      for (const name of ['model.tmp', 'reset.tmp']) if (this.files.has(name)) await this.remove(name);
      await this.prune();
      let model = null;
      for (const name of ['model.json', 'model.prev.json']) {
        try { model = await this.readSmall(name); break; }
        catch (e) { if (e.code !== 'ENOENT') this.reportFault(); }
      }
      this.ready = true;
      return model;
    } catch (e) {
      if (this.claimed) { activeDirectories.delete(this.directory); this.claimed = false; }
      this.reportFault(); return null;
    }
  }

  reportFault() {
    this.faults = Math.min(Number.MAX_SAFE_INTEGER, this.faults + 1);
    try { this.onFault(); } catch { /* Observation diagnostics cannot escape into controls. */ }
  }

  lose(count = 1) {
    this.dropped = Math.min(Number.MAX_SAFE_INTEGER, this.dropped + count);
    try { this.onLoss(count); } catch { /* Keep the producer isolated. */ }
  }

  enqueue(kind, record) {
    if (!this.ready || this.closed || !POLICIES[kind]) { this.lose(); return false; }
    // Callers supply whitelisted, structurally bounded records, not raw provider/config objects.
    let line;
    try { line = JSON.stringify(record) + '\n'; } catch { this.lose(); return false; }
    const bytes = Buffer.byteLength(line);
    if (bytes > this.limits.recordBytes || this.queue.length >= this.limits.queueRecords
      || this.queueBytes + bytes > this.limits.queueBytes) { this.lose(); return false; }
    this.queue.push({ kind, line, bytes }); this.queueBytes += bytes;
    if (this.queueBytes >= this.limits.queueBytes / 2) this.flush().catch(() => {});
    return true;
  }

  async remove(name) {
    await this.io.unlink(path.join(this.directory, name));
    this.bytes -= this.files.get(name) || 0; this.files.delete(name);
    const data = this.dataFiles.get(name);
    if (data) { this.categoryBytes[data.kind] -= data.size; this.dataFiles.delete(name); }
  }

  track(name, size) {
    this.files.set(name, size); this.bytes += size;
    const match = dataName.exec(name);
    if (match) {
      this.dataFiles.set(name, { kind: match[1], stamp: Number(match[2]), size });
      this.categoryBytes[match[1]] += size;
    }
  }

  async prune(incomingKind = null, incomingBytes = 0) {
    const now = this.now(); const sweep = now >= this.nextSweepAt;
    const overBudget = () => this.bytes + incomingBytes > this.limits.diskBytes || this.files.size + 1 > this.limits.files
      || (incomingKind && this.categoryBytes[incomingKind] + incomingBytes > POLICIES[incomingKind].bytes);
    if (!sweep && !overBudget()) return;
    for (const [name, data] of this.dataFiles) {
      const { kind, stamp } = data; const policy = POLICIES[kind];
      const over = this.categoryBytes[kind] + (incomingKind === kind ? incomingBytes : 0) > policy.bytes
        || this.bytes + incomingBytes > this.limits.diskBytes || this.files.size + 1 > this.limits.files;
      if ((sweep && now - stamp > policy.age) || over) await this.remove(name);
      if (!sweep && !overBudget()) break;
    }
    if (sweep) this.nextSweepAt = now + 300000;
    if (this.bytes + incomingBytes > this.limits.diskBytes || this.files.size + 1 > this.limits.files) throw new Error('observation quota unavailable');
  }

  async writeExclusive(name, data) {
    const bytes = Buffer.byteLength(data);
    await this.prune(null, bytes);
    const file = await this.io.open(path.join(this.directory, name), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    // Account a partial write conservatively until successful cleanup, including disk-full faults.
    this.track(name, bytes);
    try { await file.writeFile(data); }
    finally { await file.close(); }
  }

  async atomic(base, value) {
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text) > this.limits.modelBytes) throw new Error('observation model exceeds limit');
    const tmp = `${base}.tmp`; const live = `${base}.json`;
    if (this.files.has(tmp)) await this.remove(tmp);
    await this.writeExclusive(tmp, text);
    const verified = await this.readSmall(tmp);
    if (JSON.stringify(verified) !== text) throw new Error('observation checkpoint verification failed');
    if (base === 'model' && this.files.has(live)) {
      if (this.files.has('model.prev.json')) await this.remove('model.prev.json');
      await this.io.rename(path.join(this.directory, live), path.join(this.directory, 'model.prev.json'));
      this.files.set('model.prev.json', this.files.get(live)); this.files.delete(live);
    }
    const previous = this.files.get(live) || 0;
    await this.io.rename(path.join(this.directory, tmp), path.join(this.directory, live));
    this.files.set(live, this.files.get(tmp)); this.files.delete(tmp); this.bytes -= previous;
  }

  flush(snapshot) {
    if (this.busy) return this.busy;
    if (!this.ready || this.closed || this.now() < this.retryAt) return Promise.resolve(false);
    this.busy = this.drain(snapshot).finally(() => { this.busy = null; });
    return this.busy;
  }

  async drain(snapshot) {
    try {
      while (this.queue.length) {
        const first = this.queue[0]; const batch = []; let bytes = 0;
        for (const item of this.queue) {
          if (item.kind !== first.kind || bytes + item.bytes > this.limits.recordBytes) break;
          batch.push(item); bytes += item.bytes;
        }
        await this.prune(first.kind, bytes);
        const stamp = Math.max(1000000000000, Math.min(9999999999999, Math.floor(this.now())));
        const name = `${first.kind}-${stamp}-${hash(`${process.pid}:${process.hrtime.bigint()}:${this.sequence++}`).slice(0, 12)}.ndjson`;
        try { await this.writeExclusive(name, batch.map(x => x.line).join('')); }
        catch (e) { if (this.files.has(name)) await this.remove(name).catch(() => {}); throw e; }
        this.queue.splice(0, batch.length); this.queueBytes -= bytes;
        await new Promise(resolve => setImmediate(resolve));
      }
      if (snapshot) await this.atomic('model', snapshot);
      await this.prune();
      this.retryAt = 0;
      return true;
    } catch {
      // Do not retry a partially committed batch. Lost evidence is an explicit gap.
      this.lose(this.queue.length); this.queue = []; this.queueBytes = 0;
      this.retryAt = this.now() + 300000; this.reportFault(); return false;
    }
  }

  async close(snapshot) {
    if (this.busy) await this.busy;
    await this.flush(snapshot); this.closed = true; this.ready = false;
    if (this.claimed) { activeDirectories.delete(this.directory); this.claimed = false; }
  }

  status() { return { ready: this.ready, bytes: this.bytes, files: this.files.size,
    queuedBytes: this.queueBytes, queuedRecords: this.queue.length, dropped: this.dropped, faults: this.faults }; }
}

module.exports = { ObservationStore, LIMITS, POLICIES, hash, finite };
