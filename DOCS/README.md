# Alpha Edge Documentation

Start with the [product README](../README.md) or the [user guide](user/README.md).
This collection separates current operating rules, technical contracts, design
decisions and historical evidence.

## Choose Your Route

| Reader | Start here | What it owns |
| --- | --- | --- |
| User | [User guide](user/README.md) | Tasks, meanings, limits and recovery; shared with in-app Help |
| Engineer | [System guide](system/README.md) | Product boundaries, domain rules, calculations and persistence |
| Integrator | [API guide](api/README.md) | Routes, authentication, signal tracing and selected payload contracts |
| Operator | [Operations](operations/README.md) | Local setup, deploy, backup, monitoring and incident response |
| Contributor | [Development](development/README.md) | Tests, styling and documentation maintenance |
| Reviewing a proposal | [Decisions](decisions/README.md) | Staged designs, accepted decisions and remaining proposals |

## What Is Authoritative?

For **observed behaviour**, inspect the deployed schema/data and deployed revision,
then backend persistence/calculations, frontend presentation and regression tests.
The current source checkout can be ahead of a deployed release.

For **intended behaviour**, use the named current contract owner in the system
guide. When implementation is wrong, do not rewrite the docs to bless the bug.
Record the discrepancy and resolve code, tests and documentation together.
Proposals, mockups, example data and runtime prompts are not substitutes for an
approved operating rule.

## Maintenance

- [Documentation standard](development/DOCUMENTATION.md) defines ownership, checks and the Help publishing path.
- Run `npm run docs:audit` before merging documentation or API changes.

Keep secrets, real account exports and private broker statements out of public
documentation. The GitHub README is an entry point, not an alternative business-rule contract.
