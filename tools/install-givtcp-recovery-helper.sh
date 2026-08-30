#!/usr/bin/env bash
set -euo pipefail

HELPER="/usr/local/sbin/givhome-restart-givtcp"
SUDOERS="/etc/sudoers.d/givhome-restart-givtcp"
DOCKER="$(command -v docker || true)"

if [ -z "$DOCKER" ]; then
  echo "STOP: docker command not found."
  exit 1
fi

if ! id homebridge >/dev/null 2>&1; then
  echo "STOP: homebridge user not found."
  exit 1
fi

sudo -v

echo "===== INSTALL ROOT-OWNED HELPER ====="
sudo tee "$HELPER" >/dev/null <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec "$DOCKER" restart givtcp
EOF
sudo chown root:root "$HELPER"
sudo chmod 0755 "$HELPER"

echo "===== INSTALL NARROW SUDO RULE ====="
sudo tee "$SUDOERS" >/dev/null <<EOF
homebridge ALL=(root) NOPASSWD: $HELPER
EOF
sudo chown root:root "$SUDOERS"
sudo chmod 0440 "$SUDOERS"
sudo visudo -cf "$SUDOERS"

echo "===== VERIFY AS HOMEBRIDGE USER ====="
sudo -u homebridge sudo -n "$HELPER"

echo "===== COMPLETE ====="
echo "Helper:  $HELPER"
echo "Sudoers: $SUDOERS"
echo "Enable 'GivTCP Self-Recovery' in the GivHome advanced settings only after this verification passes."
