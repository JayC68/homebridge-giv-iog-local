'use strict';

(function () {
  const status = document.getElementById('givhome-config-status');
  let passthrough = [];

  homebridge.addEventListener('ready', async () => {
    try {
      const blocks = await homebridge.getPluginConfig();
      const pluginSchema = await homebridge.getPluginConfigSchema();
      const known = new Set(Object.keys((pluginSchema.schema && pluginSchema.schema.properties) || {}));
      passthrough = (blocks || []).map((block) => Object.fromEntries(Object.entries(block)
        .filter(([key]) => !known.has(key) && !['platform', 'accessory', '_bridge'].includes(key))));
      const prepared = Array.isArray(blocks) && blocks.length > 0
        ? blocks.map((block) => GivHomeConfigMigration.migrateExistingConfig(block).config)
        : [{}];
      if (Array.isArray(blocks) && blocks.length > 0) await homebridge.updatePluginConfig(prepared);
      status.textContent = '';
      status.hidden = true;

      // Use the same schema renderer as Homebridge, but keep its working copy
      // separate from the parent's config object. The stock embedded form
      // deletes properties it does not recognise before Save; older GivHome
      // versions and owner-managed extensions may legitimately have such
      // properties. Reconcile every edit back into the parent while retaining
      // those values, then leave Homebridge's normal outer Save button and
      // restart prompt in control.
      const form = homebridge.createForm(pluginSchema, prepared[0]);
      form.onChange(async (formData) => {
        const merged = [{ ...(passthrough[0] || {}), ...formData }];
        for (let index = 1; index < prepared.length; index += 1) {
          merged.push({ ...(passthrough[index] || {}), ...prepared[index] });
        }
        homebridge.disableSaveButton();
        try { await homebridge.updatePluginConfig(merged); }
        finally { homebridge.enableSaveButton(); }
      });
    } catch (error) {
      status.textContent = 'GivHome could not safely prepare the configuration form. Close this window without saving and try again.';
      homebridge.disableSaveButton();
      homebridge.toast.error(error && error.message ? error.message : String(error), 'Configuration not changed');
    }
  });
}());
