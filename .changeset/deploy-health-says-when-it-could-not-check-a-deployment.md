---
"clearotron-driver": patch
---

For operators: A health check that could not look now fails instead of reporting success. Two halves of the unit check can go quiet. One goes quiet when the installation does not say which installation it is; the other when the walk over the unit files does not finish. Both used to note that they had not run and then pass.

For operators: Set `CLEAROTRON_BOX` to `prod` or `test`. Those are the only two values the check accepts; anything else, including any other name, reads as unnamed and fails. The failure names the setting and says what went unchecked.

For operators: The half that goes quiet is the one that notices a service that has stopped and stayed stopped. The other half lists what is running, so it cannot see something that is no longer there. While that half is suppressed, a service can disappear without the check saying anything.
