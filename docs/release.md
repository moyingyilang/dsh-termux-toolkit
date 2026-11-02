# Local release build

There is no CI in this repository. Releases are assembled on the machine that builds the checkout,
the way the JMNeXt desktop packages are assembled: take the architecture-specific pieces available
locally, verify their structure, and record what was not verified.

## Command

```sh
dsh-termux release --out dist
```

Output:

```text
dist/
  android-arm64-0.3.0/
    bin/ src/ docs/ package.json README.md README.zh.md LICENSE
    native/flock/system.node      # only when the checkout has a compiled binding
    manifest.json
    checksums.txt
```

## What is verified

- Every shipped file is hashed into `checksums.txt` and repeated in `manifest.json`.
- A compiled flock binding is parsed as ELF: class (32/64-bit) and `e_machine` must match
  `process.arch` (`aarch64`, `arm`, `x86-64`). A mismatch aborts the build.
- The toolkit sources are architecture-independent JavaScript; nothing is compiled for them.

## What is not verified

- The binding is not executed on any other architecture. Cross-execution would need a kernel with
  `binfmt_misc` support and a user-mode emulator; this device has neither, so the archive says
  "structure verified" rather than "tested".
- sharp is built per device against the Termux libvips it finds, so no sharp binary is shipped.
  Image attachments still need `pkg install libvips` and one `dsh-termux build` on the target.
- The release is not signed.

## Why no CI

The previous GitHub Actions job cloned DeepSeek Harness and re-applied the patches to check for
anchor drift. That signal is real, but it ran on a hosted x86_64 runner and could never exercise
the Android-specific behaviour it was supposed to protect. The local check replaces it:
`dsh-termux doctor` and `dsh-termux patch --check` against the checkout you actually run, plus the
ELF verification in `release`.
