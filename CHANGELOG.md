## [1.0.1](https://github.com/gonimbly/gong-mcp/compare/v1.0.0...v1.0.1) (2026-06-18)


### Bug Fixes

* **gateway:** persist OAuth client registrations so connectors survive restarts ([#19](https://github.com/gonimbly/gong-mcp/issues/19)) ([f0dd43d](https://github.com/gonimbly/gong-mcp/commit/f0dd43dd20aba55159a804d5e2d4dd93772d2463))

# 1.0.0 (2026-06-17)


### Bug Fixes

* fail loudly on Gong API redirects and self-check credential at boot ([a039700](https://github.com/gonimbly/gong-mcp/commit/a03970007f9c98d1dd5ae43d99e8e34abe6fcaad))
* reset consecutive error counter before threshold test ([#9](https://github.com/gonimbly/gong-mcp/issues/9)) ([492c398](https://github.com/gonimbly/gong-mcp/commit/492c3980b4ed5e3da4dac890540c362e99659e6a))
* resolve transcript speaker IDs to participant names ([#12](https://github.com/gonimbly/gong-mcp/issues/12)) ([c1fcd23](https://github.com/gonimbly/gong-mcp/commit/c1fcd2322fa4d8805da44b7195cb6785cb87d538))
* scan calls newest-first so account queries don't miss recent calls ([#14](https://github.com/gonimbly/gong-mcp/issues/14)) ([ee955c0](https://github.com/gonimbly/gong-mcp/commit/ee955c09a13c319ca0d7eb51875be7352f971d12))
* **security:** private calls are owner-only (close visibility leak) ([#16](https://github.com/gonimbly/gong-mcp/issues/16)) ([4b5e5c5](https://github.com/gonimbly/gong-mcp/commit/4b5e5c5faab492106048883af8b6f8f56a140884))
* trust proxy headers and document org-specific Gong API base URL ([111f92e](https://github.com/gonimbly/gong-mcp/commit/111f92eae8671e5b94239cce9149aa2d8e4f7ca1))


### Features

* add interactive setup CLI for credential configuration ([e1432e4](https://github.com/gonimbly/gong-mcp/commit/e1432e42950ee59350251d2ac8c1699a1101c474))
* add remote MCP gateway with Google SSO (Phase 1) ([7096efd](https://github.com/gonimbly/gong-mcp/commit/7096efd031cf67aa3a3772c8a7f38a3bb4c4ced2))
* align entities tools to Gong's official MCP spec ([4b95708](https://github.com/gonimbly/gong-mcp/commit/4b957080fa0be0a4106564eb5238f625e814345f))
* allow domain-wide sign-in when GONG_ALLOWED_EMAILS is unset ([#2](https://github.com/gonimbly/gong-mcp/issues/2)) ([a1c8f1e](https://github.com/gonimbly/gong-mcp/commit/a1c8f1ee1c7b0c77a1c67c4734d1f41025048c2f))
* automate version bumps via semantic-release ([#15](https://github.com/gonimbly/gong-mcp/issues/15)) ([ee4c1d2](https://github.com/gonimbly/gong-mcp/commit/ee4c1d2bbe03ad6bf5915e0172e2e449cc37440b))
* enable in-app setup via gong_setup tool in Claude Desktop ([b8ce55c](https://github.com/gonimbly/gong-mcp/commit/b8ce55c0cac068fdeaa44749d784cd52b087037c))
* enforce per-user data access in the gateway (Phase 2) ([3e7edd9](https://github.com/gonimbly/gong-mcp/commit/3e7edd928b5abb56e56b2c4d98f9f8b62c1185fe))
* expand to full Gong API coverage (38 tools across 12 modules) ([97a5993](https://github.com/gonimbly/gong-mcp/commit/97a5993790b7f98d6a1bd6eef7478e3c44fd6992))
* initial Gong MCP server scaffold ([1c7011a](https://github.com/gonimbly/gong-mcp/commit/1c7011ac662c56c92681e356d0777ae85e3e0820))
* install to Claude Desktop Connectors tab from setup wizard ([0d9ec9a](https://github.com/gonimbly/gong-mcp/commit/0d9ec9a4f196dc38a0d7dd46d53f80043a4d3512))
* outline/highlights content fields + library folder recap tool ([#10](https://github.com/gonimbly/gong-mcp/issues/10)) ([09e0248](https://github.com/gonimbly/gong-mcp/commit/09e0248fc512053bc5124cd7a51ed5421c9e2062))
* Phase 3 — mirror Gong permission profiles for MCP access control ([#5](https://github.com/gonimbly/gong-mcp/issues/5)) ([33b999e](https://github.com/gonimbly/gong-mcp/commit/33b999e3ad0ff8eb83b9bc42ce007026425288e1))
* Phase 3 close-out + call-discovery composite tools ([#6](https://github.com/gonimbly/gong-mcp/issues/6)) ([1d112ba](https://github.com/gonimbly/gong-mcp/commit/1d112ba2791b6a30095539382161b513b7d88569))
* replace Basic Auth with OAuth 2.0 + PKCE for user-level access ([3afa194](https://github.com/gonimbly/gong-mcp/commit/3afa19463b11563150ef33fafa9ccffa7bca1727))
* server-side daily quota tracking and Slack alerting for Gong API ([#7](https://github.com/gonimbly/gong-mcp/issues/7)) ([f2512c1](https://github.com/gonimbly/gong-mcp/commit/f2512c1d25ec0f54d8ee7f26a14a176eb4eb6c55))
* Slack alerts for Gong MCP error conditions ([#8](https://github.com/gonimbly/gong-mcp/issues/8)) ([c17e38d](https://github.com/gonimbly/gong-mcp/commit/c17e38d60f3af4a19f07953f1783828c9ea80b73))
* store OAuth tokens in OS keychain with file fallback ([09d613d](https://github.com/gonimbly/gong-mcp/commit/09d613d7e14a6837cc1878f4ca03b6ae7a3ea0b5))
