# dsh-termux-toolkit

在 Android/Termux 上原生构建并运行 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。

上游 DeepSeek Harness 只支持 Linux、macOS 和 Windows。在 Android 上，它的宿主准备、会话锁、会话日志发布和新文件创建各自撞上一个平台缺口，没有任何配置项能绕开。本工具对 checkout 施加五个小的源码补丁，为 bionic 编译仓库自带的 flock 绑定，并用一个必需参数启动 Web UI。它不是 fork：补丁是精确文本替换，可审查、可回退；上游一改锚点，`patch --check` 就会失败并指出文件。

已在 Termux 设备上验证（android-arm64，Node v24.18.0，DeepSeek Harness 0.2.0-rc.2）。[English](README.md)。

## 修复了什么

| 缺口 | Android 上的上游行为 | 本工具的处理 |
| --- | --- | --- |
| `node-addon-require-builtin` 只发布 darwin/linux/win32 绑定 | `@deepseek-ai/dsh-app-boot` 无法准备宿主，任何 profile 都启动不了 | 解析器回退到 Node 在 `--expose-internals` 下注册的 `internal/modules/*` |
| `@deepseek-ai/node-addon-system` 的 flock 只允许 linux/darwin | 每次会话写入都失败：JSONL 存储用这把锁做跨进程租约 | 平台闸门接受 `android`；工具编译 `flock.c` 并发布 `node-addon-system-android-<arch>` |
| Android sepolicy 禁止 app 数据目录内的 `link(2)` | JSONL 存储用 `link(2)` 发布新日志，每个会话的首次写入都失败 | 发布在 `EACCES`/`EPERM` 时回退到同文件系统 `rename(2)` |
| 同一限制也拒绝 create-if-absent 用的不可覆盖硬链接 | 通过 agent 新建任何文件都以 `EACCES` 失败 | 创建回退到 `O_EXCL`，不可覆盖保证不变 |
| 同一限制也拒绝旧会话升级到新格式时的世代发布 | 打开旧会话在升级完成前就以 `EACCES` 失败 | 先检查目标，再用 `rename(2)` 发布 |

## 环境要求

- Termux（android-arm64），Node.js >= 22.19，C 编译器（`pkg install nodejs clang` 或 Termux 自带的 `cc`）
- DeepSeek Harness 的 checkout：`git clone https://github.com/deepseek-ai/deepseek-harness ~/deepseek-harness`
- checkout 固定的 JavaScript 版 pnpm：`npm install -g pnpm@11.7.0`

Android 没有 `@pnpm/exe` 二进制，而 pnpm 10+ 会把 `packageManager: pnpm@11.7.0` 解析成那个独立可执行文件。装一次 JavaScript 版即可让固定版本可解析，工具会用当前 Node 运行它。

## 快速开始

```sh
git clone https://github.com/deepseek-ai/deepseek-harness ~/deepseek-harness
git clone https://github.com/moyingyilang/dsh-termux-toolkit ~/dsh-termux-toolkit
npm install -g pnpm@11.7.0

node ~/dsh-termux-toolkit/bin/dsh-termux.mjs doctor
node ~/dsh-termux-toolkit/bin/dsh-termux.mjs build
node ~/dsh-termux-toolkit/bin/dsh-termux.mjs start
```

`build` 依次打补丁、安装依赖、构建、编译绑定。`start` 会打印 `http://127.0.0.1:3081/` 的 token URL，GUI 拒绝没有 token 的请求。实例把会话、存储和设置放在 `~/.dsh-src`，不会与 npm 安装的 `dsh` 共享状态。

把命令放进 `PATH`，免得每次写全路径：

```sh
npm link ~/dsh-termux-toolkit
```

## 命令

| 命令 | 作用 |
| --- | --- |
| `doctor` | 打印平台、checkout 版本、补丁状态、绑定状态和解析到的 pnpm |
| `patch` | 应用五个源码补丁；幂等；`--check` 只报告，上游锚点变化时退出码为 1 |
| `build` | 打补丁、`pnpm install --frozen-lockfile --ignore-scripts`、以 4 GiB 堆运行 `pnpm run build`，再编译 flock 绑定 |
| `start` | 确认绑定存在后运行 `node --expose-internals apps/cli/lib/bin.js web --port <port> --no-open` |

选项：`--repo <dir>`（默认取最近的父级 checkout，否则 `~/deepseek-harness`）、`--port <n>`、`--restart`、`--dsh-home <dir>`、`--skip-install`、`--scripts`、`--memory-mb <n>`、`--headers <dir>`、`--cc <name>`、`--force`、`--strict`。

## 五个补丁

| 补丁 | 文件 | 改动 |
| --- | --- | --- |
| `flock-android` | `native/system/packages/entry/src/flock.ts` | 平台闸门接受 `android`；bionic 既非 glibc 也非 musl，入口仍用 `bin/system.node` |
| `internals-fallback` | `packages/boot/app-boot/src/profile-resolution/resolver.ts` | `require('node-addon-require-builtin')` 失败时回退到 `require('internal/modules/*')`，该注册由 `--expose-internals` 提供 |
| `session-link-fallback` | `packages/session/session-persistence-jsonl/src/index.ts` | `link(2)` 以 `EACCES`/`EPERM` 被拒时改用 `rename(2)` 发布 |
| `migration-publish-fallback` | `packages/session/session-persistence-jsonl/src/generation.ts` | `link(2)` 被拒时先检查目标，再用 `rename(2)` 发布已校验的世代 |
| `fs-create-fallback` | `packages/fs/fs-local/src/fsio.ts` | 不可覆盖硬链接被拒时改用 `O_EXCL` 创建目标 |

每个被改的代码块都带 `dsh-termux` 注释，`grep -rn dsh-termux` 能列出全部改动点。[docs/patches.md](docs/patches.md) 说明每个补丁消除的故障和它削弱的保证。

## 保证与代价

- **会话锁**是 bionic 上真正的 POSIX `flock`，并发语义与 Linux 一致。
- **会话发布**仍然原子且持久。目标路径存在时 `link(2)` 会以 `EEXIST` 失败，所以两个进程不会互相覆盖；`rename(2)` 会静默覆盖，因此 Android 回退把这一保证缩小到前面的 `rejectExistingLog()` 检查：同一会话 id 的并发写入者现在可能赢得竞争。窗口仅限两个进程同时创建同一会话 id。
- **create-if-absent** 通过 `O_EXCL` 保留了不可覆盖保证；差别在可见性——目标文件在字节复制期间可读，而硬链接会让完整文件一次出现。
- **`--expose-internals`** 是进程级参数。工具始终传入；在没有原生绑定的宿主上直接用裸 `node apps/cli/lib/bin.js` 启动，会以提示该参数的错误退出。

## 已知的上游测试差异

上游有七个测试在 Android 上无法通过：五个断言 Android 策略禁止的硬链接行为，一个断言 `link(2)` 的权限错误必须算 IO 失败，还有一个断言 flock 补丁移除的"平台不支持"拒绝。它们覆盖的产品路径都通过回退正常工作：

- `packages/fs/fs-local/tests/fsio.spec.ts` — "maps a non-collision guarded-create publication failure and cleans staging"（注入 Android 作为策略产生的 `EACCES`）
- `packages/session/session-persistence-jsonl/tests/generation.spec.ts` — "accepts an identical publication winner and rejects different bytes"、"accepts an identical regular hardlink target"、"retains a POSIX publication after the directory sync fails"、"reports success after exclusive publication when redundant stage cleanup fails"、"accepts an identical target that wins POSIX publication"（都在模拟非 Android 平台时创建真实的硬链接）
- `native/system/test/flock.test.js` — "import succeeds with native addons disabled"（断言补丁移除的"平台不支持"拒绝路径）

原因见 `docs/patches.md`。

## 升级与锚点漂移

`pnpm run build` 从打过补丁的源码重新生成 `lib/`，所以补丁能跨构建保留。`git checkout` 或 `git pull` 重写了被补丁的文件时，下一次 `build`（或 `patch`）会自动修复。上游改动了锚点时，`patch --check` 退出码为 1 并指出文件；请按新文本重新推导该处替换，并更新 `src/patches/`。

把 checkout 恢复成上游原始状态：

```sh
cd ~/deepseek-harness && git checkout -- \
  native/system/packages/entry/src/flock.ts \
  packages/boot/app-boot/src/profile-resolution/resolver.ts \
  packages/session/session-persistence-jsonl/src/index.ts \
  packages/fs/fs-local/src/fsio.ts
```

## 限制

- 仅限 Android。补丁只用于消除 Android 平台缺口，不会在其他宿主上自动应用。
- 桌面端和仅 Windows 的原生依赖（`koffi`）不在范围内，安装因此使用 `--ignore-scripts`。
- 绑定针对当前运行的 Node 编译，Node 大版本升级后需要重新 `build`（`start` 也会在绑定缺失时重新编译）。
- `dsh-termux-toolkit` 与 DeepSeek 官方无关，它修改的是你自己的 checkout。

## 测试

```sh
npm test
```

测试用上游文件摘录施加补丁，验证锚点唯一、幂等、拒绝半应用，并在存在 checkout 时断言所有锚点仍与真实上游一致。

## 许可证

MIT。被补丁的源码文件仍遵循 DeepSeek Harness 的许可证。
