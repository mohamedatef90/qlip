# Qlip for iOS

Native SwiftUI client for the same Supabase vault used by the Qlip web app.
The deployment target is iOS 17 and the Supabase Swift package is pinned in
`Package.resolved`.

## Implemented native client

1. Email/password authentication with Supabase Auth.
2. Full paginated Library backed by `content_items`, with a SwiftData offline cache and the same Reading / Bookmarks / Mobile split as web.
3. Manual URL save and Share Extension save with automatic or explicit Reading / Bookmarks destination choices.
4. The Share Extension and manual capture write URLs to a durable App Group
   inbox before networking; the authenticated app drains it into `save-item`.
5. Supabase Realtime refreshes `pending → parsing → enriching → ready` states.
6. A native Reader renders the thumbnail, AI summary, key points and extracted content.
7. A best-effort iOS background refresh retries unsent inbox links after the
   app is suspended. Once `save-item` accepts a URL, parsing and AI enrichment
   run on Supabase and continue independently of the phone app.
8. Database-backed Priority Vault ordering, nightly resurfaced picks, folders/categories and MCP agent-key management stay synchronized with web.
9. Three matching appearance modes, the white Qlip launch identity, social thumbnails and a minimum 1.5-second splash are included in the app and extension.

No AI, service-role or provider secret is present in the app. The only bundled
Supabase credential is the public anonymous/publishable key; RLS and the user's
JWT scope every database operation.

## Xcode setup

- Open `Qlip.xcodeproj` and select a development team for both `Qlip` and
  `QlipShare`.
- Register the App Group `group.com.mohamedatef.Qlip` for both bundle IDs.
- In Signing & Capabilities, add **Background Modes** and enable
  **Background fetch** for the Qlip target before distributing the build.
- Keep the main bundle ID `com.mohamedatef.Qlip` and extension bundle ID
  `com.mohamedatef.Qlip.QlipShare`, or update the identifiers and entitlements
  together.
- Run the `Qlip` scheme. Sign in with the same account as the web app.

Command-line Simulator verification:

```bash
xcodebuild -project Qlip.xcodeproj -scheme Qlip \
  -configuration Debug -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

## Future optional increments

- Auth deep links and Sign in with Apple.
- Native TTS and Arabic translation controls (the underlying server functions already exist for web).
- XCTest coverage with an isolated Supabase test account.
