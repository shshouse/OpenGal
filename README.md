<div align="center">

<img src="public/OpenGalLogo.png" alt="OpenGal" width="128" />

# OpenGal

**一个拥有长期记忆的 Live2D 桌面伴侣**

她可以一直陪你聊下去——记得你说过的话、你的偏好、你们之间的约定。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-32-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows-lightgrey)](https://github.com/)

</div>

---

## 为什么做 OpenGal

大多数 AI 桌面宠物是“金鱼”——关掉窗口，一切归零。OpenGal 的目标不一样：**没有“会话”的概念，对话是一直延续的**。你三周前提到的生日、上个月答应一起看的樱花、你随口说讨厌香菜——她都记得，并且在之后的日子里自然地提起。

## 特性

- **Live2D 桌宠** — 视线追踪、动作、情绪表达，有形象的陪伴而不是一个聊天窗口
- **长期记忆系统** — 四层记忆架构（身份 / 时间线摘要 / 结构化事实 / 原文存档），聊得越久越懂你
- **导演决策** — 三态决策（回应 / 等待 / 沉默），不抢话、会倾听，更接近真实的陪伴感
- **语音交互** — ASR 语音识别 + TTS 语音合成，说话而不是打字
- **多模型热切换** — OpenAI 兼容 API，预设列表随时切换提供商和参数
- **纯本地存储** — 所有记忆在本地 SQLite（WAL），数据不出你的电脑
- **工具调用** — LLM function calling，可以执行本地动作

## 记忆系统

OpenGal 的核心。不是“把聊天记录塞回去”，而是模拟人类记忆的工作方式：

```
写入 → 从对话中提取值得记住的事实与经历
管理 → 冲突仲裁、证据累积、时间衰减、手动记忆豁免
读取 → 相关记忆注入 + 分层上下文（1M 窗口 + 存档式压缩）
```

| 层 | 内容 | 载体 |
|---|---|---|
| L0 身份 | 角色卡、核心设定（常驻） | 角色卡 |
| L1 时间线摘要 | 按时间段压缩的对话摘要 | SQLite `summaries` |
| L2 结构化事实 | 三元组事实 + 证据计数 + 手动豁免 | SQLite `facts` / `stories` |
| L3 原文存档 | 完整对话原文（永不删除，仅标记归档） | SQLite `messages` |

## 技术栈

- **桌面**：Electron 44 + electron-vite
- **前端**：React 18 + TypeScript + Tailwind CSS + Zustand
- **渲染**：PixiJS + pixi-live2d-display
- **存储**：node:sqlite（Electron 内置原生 SQLite，WAL 模式，写即持久）
- **LLM**：OpenAI 兼容 API（任意提供商）

## 项目结构

```
src/
├── main/           # Electron 主进程
│   ├── services/   # memoryDb（SQLite）、memoryStore（记忆业务）、LLM/TTS/ASR 适配
│   └── ipc/        # IPC 注册
├── preload/        # 桥接层（contextBridge API）
├── renderer/       # React 前端
│   └── src/features/
│       ├── pipeline/   # 对话管线（director / llm / tts worker）
│       ├── chat/       # 会话状态（增量同步 SQLite）
│       ├── memory/     # 记忆快照与注入
│       └── live2d/     # Live2D 舞台
└── shared/         # 主/渲染进程共享类型与通道定义
```

## 路线图

- [x] 四层记忆架构 + SQLite 存储
- [x] 存档式上下文压缩（1M 窗口）
- [x] 导演三态决策 + TTS 打断
- [ ] 写入流水线：三元组事实 + 时间有效性 + 遗忘曲线
- [ ] 检索注入 + 冻结快照
- [ ] 本地向量检索（可选，ONNX embedding）
