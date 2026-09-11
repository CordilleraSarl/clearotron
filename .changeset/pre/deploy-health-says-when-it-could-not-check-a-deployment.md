---
"clearotron-driver": patch
---

For operators: A deployment health check that could not finish now fails instead of reporting success. Two parts of the service check could skip themselves. One skipped when the installation did not say which installation it is; the other when the scan of the service files did not finish. Both used to note that they had not run and then pass.

For operators: Set `CLEAROTRON_BOX` to `prod` or `test`. Those are the only two values the check accepts; anything else, including any other name, reads as unnamed and fails. The failure names the setting and says what went unchecked.

For operators: The part that could skip itself is the one that notices a service that has stopped and stayed stopped. The other part lists what is running, so it cannot see something that is no longer there. While the first part is skipped, a service can disappear without the check saying anything.
