// Excerpt of packages/boot/app-boot/src/profile-resolution/resolver.ts from DeepSeek Harness 0.2.0-rc.2, kept verbatim so the
// patch anchors can be exercised without a full checkout.

function internalModules(): InternalModules {
  const require = createRequire(import.meta.url)
  const addon = require('node-addon-require-builtin') as { requireBuiltin(moduleId: string): unknown }
  const esmModule = addon.requireBuiltin('internal/modules/esm/loader') as {
    getOrInitializeCascadedLoader(): ModuleLoaderV1 | ModuleLoaderV2
  }
  const cjsModule = addon.requireBuiltin('internal/modules/cjs/loader') as { Module: CommonJsModule }
  const cjsHelpers = addon.requireBuiltin('internal/modules/helpers') as {
    getCjsConditions(): ReadonlySet<string>
