# Putting this source on GitHub

Use the prepared **Loud** folder, not the live booth folder or its parent directory. The ZIP is a transport copy: extract it first, rather than committing the ZIP itself.

An easy route is [GitHub Desktop](https://desktop.github.com/): sign in, create a repository named `Loud` using the prepared folder's parent as its local path, review the proposed files, make an initial commit, then choose **Publish repository**. Choose private or public when you publish. GitHub Desktop is only a convenience for publishing; users running Loud do not need it.

Review the source files before publishing. The proposed commit should contain `app`, `lib`, `scripts`, `tests`, `deploy`, the two worklets in `public`, documentation, package manifests, and configuration. It should contain no `node_modules`, `.next`, data, private environment files, music, model weights, installed runtimes or built executables. The supplied `.gitignore` excludes those generated files on subsequent commits too.

Publish `Loud-Offline-Setup-x64.exe` as a GitHub Release asset, not as a repository blob. The build script stages files outside the repository, strips Python bytecode and local runtime manifests, rejects music/private state, and refuses to package the Demucs checkpoint. The release notes must state that the unsigned wizard downloads that one official checkpoint and verifies it.

Loud uses the accompanying Loud Noncommercial License 1.0. Include `LICENSE` in the repository and distributions. The `private` field in `package.json` prevents accidental npm publication; it does not control GitHub visibility. Authenticate with the intended GitHub account before publishing.

Publishing the repository shares source code. It does not start a hosted Loud service or upload anyone's music.
