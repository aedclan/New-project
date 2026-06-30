# 更新流程

## UI 规范化升级流程

以后所有 UI 相关升级，默认先执行本流程，再进入代码改动。

### 1. 读取规范

每次 UI 改动前必须先对照：

```text
PROJECT_UI_AND_WORKFLOW_STANDARD.md
UI_UNIFICATION_PLAN.md
```

其中：

- `PROJECT_UI_AND_WORKFLOW_STANDARD.md` 是纯设计规范，只定义视觉、布局、组件、响应式、状态和验收标准。
- `UI_UNIFICATION_PLAN.md` 是执行计划，定义当前 UI 规范化分层路线、当前轮次、完成项和下一步。

### 2. 判断层级

每次 UI 改动必须先判断属于哪一层：

```text
第 1 层：设计变量统一
第 2 层：基础组件统一
第 3 层：全局布局统一
第 4 层：移动端统一
第 5 层：状态和边界统一
```

默认推进顺序必须从低风险到高风险：

```text
变量 -> 组件 -> 布局 -> 移动端 -> 状态
```

### 3. 控制范围

每一轮 UI 规范化必须控制范围：

- 不借 UI 规范化改业务功能。
- 不一次性重写大面积页面结构。
- 不覆盖与当前任务无关的已有改动。
- 不随意新增一套页面专属风格。
- 新增样式优先使用设计变量和已有组件。

### 4. 执行记录

每轮完成后必须更新 `UI_UNIFICATION_PLAN.md`：

- 记录本轮做了什么。
- 标记完成项。
- 写明下一轮任务。
- 写明是否运行检查。

### 5. 验收

每轮 UI 改动后必须检查：

```text
桌面端布局
移动端横向溢出
按钮和输入框高度
focus / hover / disabled 状态
长文本和窄屏表现
空状态、加载状态、错误状态
```

基础检查命令：

```powershell
npm run check
```

如果本机没有全局 npm，使用 Codex 内置 Node：

```powershell
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts/check.mjs
```

## 本地

```powershell
npm run check
git status
git add .
git commit -m "feat: 本次更新说明"
git push origin main
```

## VPS

当前路径：

```bash
/opt/New-project
```

更新：

```bash
cd /opt/New-project
./scripts/deploy-vps.sh
```

手动更新备用命令：

```bash
cd /opt/New-project
git pull --ff-only
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:5173/healthz
```

## 回滚

```bash
cd /opt/New-project
./scripts/rollback-vps.sh
```
