# Replacement backlog

The personal-host direction supersedes the old relay/hosted architecture. [Architecture](ARCHITECTURE.md) defines ownership; [runtime contract](RUNTIME_CONTRACT.md) defines behavior and OPEN gates. GitHub issues own scoped execution; this table records sequence, not completed implementation.

| Order | Issue | Deliverable and dependency |
|---|---|---|
| 1 | [#81](https://github.com/CrowBe/ScrolLess/issues/81) | Documentation/runtime contract only; this change |
| 2 | [#82](https://github.com/CrowBe/ScrolLess/issues/82) | One real browser source through Jev, SQLite and reader; resolve first-slice contract gates |
| 3 | [#83](https://github.com/CrowBe/ScrolLess/issues/83) | Resumable collection and revision-aware decisions; prove interruptions and reuse |
| 4 | [#84](https://github.com/CrowBe/ScrolLess/issues/84) | Scheduling, personal-host deployment, backups and verified existing-data migration |
| 5 | [#85](https://github.com/CrowBe/ScrolLess/issues/85) | Search the captured corpus independently of presentation |
| 6 | [#86](https://github.com/CrowBe/ScrolLess/issues/86) | Topical news discovery entering the same collection pipeline |
| 7 | [#87](https://github.com/CrowBe/ScrolLess/issues/87) | Ownership-aware deletion/reset for host data, observation history and client cache |

Search, discovery and reset may be prioritized independently once their foundations exist. A slice may implement only one supported adapter/engine; it must not weaken the durable contract to imply broader support.

[#54](https://github.com/CrowBe/ScrolLess/issues/54) and [#56](https://github.com/CrowBe/ScrolLess/issues/56) were closed as superseded, not completed implementations. #81 replaces #54's architectural premise; #87 carries forward deletion work under the new ownership model.

Tier billing, multi-tenant hosted identity, mandatory Postgres migration and Expo entitlements gates are [archived plans](archive/README.md). Additional stores, engines or native clients need separately scoped decisions. Existing UI improvements may be revisited against current code; old unchecked lists are not proof of remaining bugs.

Before implementation, link the applicable runtime contract sections and resolve that slice's policy gates. Before release, provide the evidence in [pre-release tasks](pre-release-tasks.md).
