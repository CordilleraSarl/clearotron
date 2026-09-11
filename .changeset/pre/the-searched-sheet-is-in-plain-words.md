---
"clearotron-driver": patch
---

Fixed: The audit workbook's "What was searched" sheet is now in plain words. Its Result and Note columns carry the search log's own notes. Internal terms could reach them: a status such as "deferred", a full web address, a bare HTTP code. Those words are now replaced as the workbook is built, a republished report included. A search recorded as not run still reads as not searched. Search terms and names stay exactly as written, because they record what was searched.
