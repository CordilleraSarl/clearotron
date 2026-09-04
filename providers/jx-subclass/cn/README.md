# China — the cross-reference notes

## What is here

`pages/` — all **278 pages** of the official 区分表 rendered at 150 dpi (72 MB).

Source PDF: `the operator-held copy of qufenbiao-12ed-full.pdf` —
《类似商品和服务区分表——基于尼斯分类第十二版（2023文本）》, 商标局, 126,137,158 bytes,
obtained July 2026 from sbj.cnipa.gov.cn via a complete Wayback capture. Not re-copied here.

## Why images

**The PDF has no extractable text.** `pdftotext` returns zero characters on every page tested
(5, 30, 60, 100, 200); `pdfimages` shows each page is a JPEG. It is a scanned/InDesign-flattened
document. Any text route requires reading the images.

The pages render cleanly and legibly at 150 dpi.

## The cross-references are there, and they are explicit

Rendered page `p-058.png` (printed page 032, group 0501) carries a 注 block of nine numbered notes.
It yields these relations for group 0501 alone:

| relation | to | note |
|---|---|---|
| 类似 (similar) | `0502` | part (一) paras 1–2 ↔ 0502 para 1 含药物的糖果, 医用树胶, 医用冰糖 |
| 类似 | `3005` | part (一) paras 1–2, excluding human medicines |
| 类似 | `0503` | 杀真菌剂/杀菌剂/灭菌剂/消毒剂 ↔ 化学盥洗室用消毒剂 |
| 类似 | `0505` | ↔ 灭干朽真菌制剂, 灭微生物剂, 土壤消毒制剂 |
| 类似 | `1001` | 轻便药箱, 急救箱 ↔ 医生用器械箱, 医疗器械箱 |
| 类似 | `0504` | 防寄生虫制剂, 驱肠虫药 … |
| 类似 | `0301`, `0306` | 医用洗浴制剂, 药浴用海水, 浴用泥浆 ↔ 洗澡用化妆品 |
| 交叉检索 (cross-search) | `3002`, `0506`, `0507` | against 9th/11th-edition-and-earlier groups |

Also note 1: within a similar group the parts are normally **not** similar to each other — an
intra-group exception that a naive reading would miss entirely.

So the notes name group codes explicitly and distinguish 类似 (similar) from 交叉检索 (cross-search),
and they carry edition qualifiers. This is structured enough to extract reliably.

## Route

Not OCR. A vision model reads the rendered page; the printed page number is the citation, so any
row a lawyer doubts can be checked against the official document in seconds. That is the same
principle as the rest of this work — the model reads a supplied document instead of recalling.

**Not yet done.** 278 pages to read, and the output needs sampling against the source before use.
Only pages carrying a 注 block matter, which is a subset.
