# 发布到 npm

仓库在推送到 `main` 以及面向 `main` 的 Pull Request 上运行 CI。手动 **Publish** workflow 从 `main` 构建和验证安装包，然后使用 GitHub OIDC 将该 tarball 发布到 `@eihrteam/xml-lsp`。

## 一次性建立信任

在 npm 上创建包后，由具有包写权限的 npm 维护者打开包设置并添加 GitHub Actions Trusted Publisher。设置组织为 `EIHRTeam`，仓库为 `xml-lsp`，工作流为 `publish.yml`，环境为 `npm`，允许直接执行 `npm publish`。也可通过 npm 11.15 或更新版本使用已登录且通过交互式 2FA 的 npm 会话执行同样的设置。[npm Trusted Publishers](https://docs.npmjs.com/trusted-publishers/)

```sh
npm trust github @eihrteam/xml-lsp --repo EIHRTeam/xml-lsp --file publish.yml --env npm --allow-publish
```

npm 会将刚创建的配置标记为 **Pending validation**。在包设置页显示的期限内通过受信任工作流成功发布一次，npm 会验证配置并绑定仓库身份。若使用预发布版验证，请选 `next` 或 `beta`。配置过期后，需要在下一次发版前重新建立绑定。

## 后续发布

1. 更新根 `package.json` 的版本并合并到 `main`。
2. 等待该提交的 CI 通过。
3. 在 GitHub Actions 中运行 **Publish**，选择 `main` 并输入同一版本。正式版选择 `latest`，预发布版选择 `next` 或 `beta`。
4. 确认 npm 版本和 dist-tag。

```sh
npm view @eihrteam/xml-lsp version dist-tags --json
```

可在本地复现已安装包的入口与 CLI 验证。

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test:package
```
