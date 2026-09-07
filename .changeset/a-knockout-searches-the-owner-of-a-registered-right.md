---
"prelim-driver": patch
---

New: A Knockout search now looks up what the owner of a registered right actually sells, and the report says where that answer came from. Before, the assessment inferred the owner's trade from the company name alone, then told you to go and obtain the registration's own goods list. The name is not evidence of the trade. It happened to read correctly on one search and would have read confidently wrong on the next.

Fixed: Where the lookup finds nothing, the report says so plainly and still delivers. An unanswered search is never written up as a clean negative, and a provider outage never withholds a report.

For operators: this adds one web search per promoted registered filing, deduplicated by owner and capped at three per searched name. A search with no registered right against it costs nothing extra.
