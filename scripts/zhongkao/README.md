# 杭州中考知识点生成流水线

为语文、数学、英语、科学、社会五科生成按年级分类的知识点标签，并标注中考高频考点，
输出到 `src/lib/tag-data/zhongkao/*.json`，由 `src/lib/tag-data/seed.ts` 合并进系统标签。

```bash
npm run zhongkao:build -- all            # 抓目录 → LLM 充实 → 校验输出
npm run zhongkao:build -- enrich --subject=science --concurrency=4
npm run zhongkao:build -- emit           # 只重新校验输出（不调用 LLM）
```

## 三个步骤

| 步骤 | 输入 | 输出 |
| --- | --- | --- |
| `fetch` | `sources.mjs` 中各册教材目录页（dzkbw.com，GBK，限速 1.5s/页，HTML 缓存在 `.cache/zhongkao/html`） | `toc/<subject>.json`（提交到仓库，之后无需联网） |
| `enrich` | `toc/*.json` + `static/*.json` + `evidence.md` | 每章一次 LLM 调用，结果按提示词哈希缓存在 `.cache/zhongkao/llm`，失败的章重跑即可补齐 |
| `emit` | 以上全部 | `src/lib/tag-data/zhongkao/<subject>.json` 和审核报告 `doc/zhongkao-tags-report.md` |

`static/` 放没有在线目录的部分：人文地理（按课标主题）、新版九下尚未发行时的暂列内容、
语文和英语的中考专项。已写明 `tags` 的节不调用 LLM。

## 高频标记的约束

高频只来自 `evidence.md` 收录的浙江省教育考试院官方试题评析。模型标高频时必须原文引用
一条 `- ` 开头的具体考点，`emit` 会校验引用确实存在，并限制每节最多 1 个高频；
校验不过的会降为普通并记入报告。新一年的评析发布后，把考点追加到 `evidence.md` 再跑 `all`。

## LLM 配置

OpenAI 兼容接口：`ZK_API_KEY`（缺省读 `MINIMAX_API_KEY` 或 `.env.local`）、
`ZK_BASE_URL`（缺省 `https://api.minimax.io/v1`）、`ZK_MODEL`（缺省 `MiniMax-M3.1-Flash-Preview`）。

## 发布

生成数据随代码发布：提高 `package.json` 版本号后重新部署，容器启动时检测到版本变化，
会运行 `rebuild-system-tags` 重建系统标签，已有错题的标签关联按名称恢复。
