import Foundation
import Combine
import Supabase

@MainActor
final class QlipStore: ObservableObject {
    @Published private(set) var items: [ContentItem] = []
    @Published private(set) var folders: [QlipFolder] = []
    @Published private(set) var dailyPickIDs: Set<UUID> = []
    @Published private(set) var apiKeys: [QlipAPIKey] = []
    @Published private(set) var isAuthenticated = false
    @Published private(set) var userEmail: String?
    @Published private(set) var isLoading = false
    @Published private(set) var isSaving = false
    @Published private(set) var queuedSaveCount = 0
    @Published private(set) var lastSyncedAt: Date?
    @Published var errorMessage: String?
    @Published var noticeMessage: String?

    private let client = AppConfig.supabase
    private let cache = ItemCache()
    private var realtimeTask: Task<Void, Never>?
    private var structureRealtimeTasks: [Task<Void, Never>] = []
    private var realtimeRefreshTask: Task<Void, Never>?
    private var refreshInFlight = false
    private var refreshRequested = false
    private var queueFlushInFlight = false

    private var usesPreviewVault: Bool {
#if DEBUG
        ProcessInfo.processInfo.arguments.contains("-ui-preview-vault") || UserDefaults.standard.bool(forKey: "ui-preview-vault")
#else
        false
#endif
    }

    private let listColumns = "id,url,title,description,author,summary,key_points,tags,topic,content_type_label,source_type,item_kind,saved_via,status,site_name,thumbnail_url,favicon_url,read_status,is_starred,is_pinned,pin_position,published_at,created_at,word_count,duration_seconds,item_folders(folder_id,assignment_source)"
    private let detailColumns = "id,url,title,description,author,summary,key_points,tags,topic,content_type_label,source_type,item_kind,saved_via,status,site_name,thumbnail_url,favicon_url,read_status,is_starred,is_pinned,pin_position,published_at,created_at,word_count,duration_seconds,item_folders(folder_id,assignment_source),content_text"
    private let folderColumns = "id,name,color,icon,parent_id,position"
    private let apiKeyColumns = "id,name,key_prefix,created_at,last_used_at,revoked_at"

    init() {
#if DEBUG
        if usesPreviewVault {
            loadPreviewVault()
            return
        }
#endif
        items = cache.load()
        queuedSaveCount = ShareInbox.pending().count
        Task { await restoreSession() }
    }

#if DEBUG
    /// Simulator-only visual fixture. It is activated only with
    /// `-ui-preview-vault`, so it never replaces a signed user's vault.
    private func loadPreviewVault() {
        let workFolder = UUID(uuidString: "4A6D6C1B-E6A8-4A1D-8B39-017D2F99D0A1")!
        let learnFolder = UUID(uuidString: "A75AB52E-0BBE-4A11-9AF1-2D4E54F6E112")!
        let now = Date()

        folders = [
            QlipFolder(id: workFolder, name: "Work", color: "bg-[#c1ff00]", icon: "fa-briefcase", parentID: nil, position: 0),
            QlipFolder(id: learnFolder, name: "Learning", color: "bg-[#8b5cf6]", icon: "fa-book", parentID: nil, position: 1)
        ]
        items = [
            ContentItem(
                id: UUID(uuidString: "E4A9FBBE-8B84-4E1E-B169-58DBB5927061")!,
                url: URL(string: "https://www.facebook.com/example/posts/123")!,
                title: "How small teams can use AI without losing their point of view",
                description: "A saved Facebook post with a long title to test wrapping and social metadata.",
                author: "Maya Chen",
                summary: "A thoughtful framework for pairing human judgment with AI tools. It makes a useful test case for social cards, long copy, and the reader.",
                keyPoints: ["Start with the decision, not the model.", "Keep a human owner for the final call.", "Document what the system should never decide."],
                tags: ["AI", "Teams"],
                topic: "Technology",
                contentTypeLabel: "Facebook post",
                sourceType: "reel",
                itemKind: "content",
                savedVia: "mobile",
                status: .ready,
                siteName: "Facebook",
                thumbnailURL: nil,
                faviconURL: nil,
                readStatus: "reading",
                isStarred: true,
                isPinned: true,
                pinPosition: 0,
                publishedAt: now.addingTimeInterval(-86_400 * 2),
                createdAt: now.addingTimeInterval(-86_400),
                contentText: "A useful AI practice starts with a plain question: what decision are we trying to make? The tool should support that decision, not quietly replace the people accountable for it.\n\nSmall teams get the most value when they define the boundary first. Let automation collect context, structure drafts, and surface options—but make the owner of a decision visible.\n\nThe last step is a short record of what the system can do, what it cannot do, and who reviews it. That turns an experiment into a trustworthy habit.",
                wordCount: 148,
                durationSeconds: nil,
                itemFolders: [ItemFolder(folderID: workFolder, assignmentSource: "user")]
            ),
            ContentItem(
                id: UUID(uuidString: "A1B2C3D4-E5F6-4A7B-8C9D-0123456789AB")!,
                url: URL(string: "https://www.youtube.com/watch?v=qlip-reader-test")!,
                title: "YouTube reader navigation test",
                description: "A phone-shared YouTube video used only to verify that this card opens its own reader.",
                author: "Qlip test channel",
                summary: "This card must open the YouTube reader, never the Facebook post beside it.",
                keyPoints: ["Routes by immutable item ID.", "Stays in Mobile only.", "Opens Qlip Reader."],
                tags: ["Video", "Testing"],
                topic: "Technology",
                contentTypeLabel: "YouTube video",
                sourceType: "youtube",
                itemKind: "content",
                savedVia: "extension",
                status: .ready,
                siteName: "YouTube",
                thumbnailURL: nil,
                faviconURL: nil,
                readStatus: "unread",
                isStarred: false,
                isPinned: false,
                pinPosition: nil,
                publishedAt: nil,
                createdAt: now,
                contentText: "YouTube Reader Marker\n\nThis is the exact YouTube item selected from the Mobile section. Seeing this text proves that navigation did not fall through to a different Facebook card.",
                wordCount: 30,
                durationSeconds: 180,
                itemFolders: nil
            ),
            ContentItem(
                id: UUID(uuidString: "D0A8ABF5-9E7A-4D75-A7C4-B65A5EAE712D")!,
                url: URL(string: "https://www.nngroup.com/articles/ten-usability-heuristics/")!,
                title: "Ten usability heuristics for a calmer product experience",
                description: "A long-form reading item for testing the article reader.",
                author: "Nielsen Norman Group",
                summary: "Classic usability principles are still valuable for AI-native products because they make system behavior legible.",
                keyPoints: ["Show system status.", "Use familiar language.", "Offer recovery from mistakes."],
                tags: ["UX", "Product"],
                topic: "Design",
                contentTypeLabel: "Article",
                sourceType: "article",
                itemKind: "content",
                savedVia: "web",
                status: .ready,
                siteName: "NN/g",
                thumbnailURL: nil,
                faviconURL: nil,
                readStatus: "unread",
                isStarred: false,
                isPinned: false,
                pinPosition: nil,
                publishedAt: nil,
                createdAt: now.addingTimeInterval(-4_200),
                contentText: "People judge a product by how clearly it explains what is happening. An interface does not need to be loud to be clear; it needs to keep its promises and provide feedback at the right moment.\n\nWhen a task fails, tell people what happened and show the next safe action. When a task succeeds, make the result visible without interrupting their flow.",
                wordCount: 91,
                durationSeconds: nil,
                itemFolders: [ItemFolder(folderID: learnFolder, assignmentSource: "ai")]
            ),
            ContentItem(
                id: UUID(uuidString: "C2D4AF12-2539-4A5E-8A33-B5343A5D147D")!,
                url: URL(string: "https://linear.app")!,
                title: "Linear",
                description: "A regular bookmark to validate the external-link card path.",
                author: nil,
                summary: "A website bookmark that opens in Safari rather than the reader.",
                keyPoints: nil,
                tags: [],
                topic: nil,
                contentTypeLabel: "Bookmark",
                sourceType: "other",
                itemKind: "bookmark",
                savedVia: "web",
                status: .ready,
                siteName: "Linear",
                thumbnailURL: nil,
                faviconURL: nil,
                readStatus: "unread",
                isStarred: false,
                isPinned: false,
                pinPosition: nil,
                publishedAt: nil,
                createdAt: now.addingTimeInterval(-9_000),
                contentText: nil,
                wordCount: nil,
                durationSeconds: nil,
                itemFolders: nil
            )
        ]
        dailyPickIDs = [items[1].id]
        isAuthenticated = true
        lastSyncedAt = now
    }
#endif

    func restoreSession() async {
        if let session = try? await client.auth.session {
            isAuthenticated = true
            userEmail = session.user.email
            ShareInbox.cacheAccessToken(session.accessToken)
            await refresh()
            await startRealtime()
            await flushPendingLinks()
        } else {
            isAuthenticated = false
        }
    }

    func signIn(email: String, password: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            try await client.auth.signIn(email: email, password: password)
            let session = try await client.auth.session
            isAuthenticated = true
            userEmail = session.user.email
            ShareInbox.cacheAccessToken(session.accessToken)
            await refresh()
            await startRealtime()
            await flushPendingLinks()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func signUp(email: String, password: String) async {
        let cleanEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanEmail.isEmpty, !password.isEmpty else {
            errorMessage = "Enter an email address and password to create an account."
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            try await client.auth.signUp(email: cleanEmail, password: password)
            showNotice("Account created. Check your email to confirm it, then sign in.")
        } catch {
            errorMessage = "Could not create your account: \(error.localizedDescription)"
        }
    }

    func resetPassword(email: String) async {
        let cleanEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanEmail.isEmpty else {
            errorMessage = "Enter your email address first, then choose Forgot password."
            return
        }
        do {
            try await client.auth.resetPasswordForEmail(cleanEmail)
            showNotice("Password reset instructions were sent to \(cleanEmail).")
        } catch {
            errorMessage = "Could not start password reset: \(error.localizedDescription)"
        }
    }

    func signOut() async {
        realtimeTask?.cancel()
        structureRealtimeTasks.forEach { $0.cancel() }
        realtimeRefreshTask?.cancel()
        realtimeTask = nil
        structureRealtimeTasks = []
        realtimeRefreshTask = nil
        try? await client.auth.signOut()
        items = []
        folders = []
        dailyPickIDs = []
        apiKeys = []
        cache.clear()
        ShareInbox.clear()
        queuedSaveCount = 0
        isAuthenticated = false
        userEmail = nil
    }

    func refresh(showSuccessNotice: Bool = false) async {
        if refreshInFlight {
            refreshRequested = true
            return
        }
        refreshInFlight = true
        isLoading = true
        defer {
            isLoading = false
            refreshInFlight = false
        }
        repeat {
            refreshRequested = false
            do {
                async let itemsRequest = fetchAllItems()
                async let foldersRequest: [QlipFolder] = client
                    .from("folders")
                    .select(folderColumns)
                    .order("position", ascending: true)
                    .execute()
                    .value
                async let picksRequest: [QlipDailyPick] = client
                    .from("daily_picks")
                    .select("item_id")
                    .execute()
                    .value
                async let apiKeysRequest: [QlipAPIKey] = client
                    .from("api_keys")
                    .select(apiKeyColumns)
                    .order("created_at", ascending: false)
                    .execute()
                    .value

                let (refreshed, refreshedFolders, refreshedPicks, refreshedKeys) = try await (
                    itemsRequest, foldersRequest, picksRequest, apiKeysRequest
                )
                items = refreshed
                folders = refreshedFolders
                dailyPickIDs = Set(refreshedPicks.map(\.itemID))
                apiKeys = refreshedKeys
                cache.replace(with: refreshed)
                ShareInbox.cacheFolders(refreshedFolders)
                lastSyncedAt = .now
                if showSuccessNotice { showNotice("Your vault is up to date.") }
            } catch is CancellationError {
                // SwiftUI cancels the task when its view disappears. That is
                // expected navigation behavior, never a user-facing failure.
                return
            } catch {
                guard !Task.isCancelled else { return }
                errorMessage = error.localizedDescription
            }
        } while refreshRequested
    }

    /// PostgREST projects commonly cap one response at 1,000 rows even when a
    /// larger limit is requested. Page deterministically so mobile and web see
    /// the same complete vault as it grows.
    private func fetchAllItems() async throws -> [ContentItem] {
        let pageSize = 1_000
        var allItems: [ContentItem] = []
        var from = 0

        while true {
            let page: [ContentItem] = try await client
                .from("content_items")
                .select(listColumns)
                .order("created_at", ascending: false)
                .order("id", ascending: false)
                .range(from: from, to: from + pageSize - 1)
                .execute()
                .value
            allItems.append(contentsOf: page)
            if page.count < pageSize { break }
            from += pageSize
        }
        return allItems
    }

    @discardableResult
    func save(
        urlText: String,
        destination: SaveDestination = .auto,
        folderID: UUID? = nil,
        note: String? = nil
    ) async -> Bool {
        guard let url = normalizedURL(urlText) else {
            errorMessage = "Enter a valid http or https URL."
            return false
        }
        // Make capture durable before networking. If iOS suspends the app after
        // the user leaves, the background task retries this inbox item later;
        // save-item's canonical-URL dedupe makes retries safe.
        ShareInbox.enqueue(
            url,
            destination: destination,
            folderID: folderID,
            savedVia: "mobile",
            note: note
        )
        queuedSaveCount = ShareInbox.pending().count
        BackgroundRefresh.schedule()
        showNotice("Link captured. AI will keep working in the background.")

        isSaving = true
        defer { isSaving = false }
        Task { await flushPendingLinks() }
        return true
    }

    func loadDetail(for id: UUID) async -> ContentItem? {
        if let cached = items.first(where: { $0.id == id }), cached.contentText != nil {
            return cached
        }
        do {
            let item: ContentItem = try await client
                .from("content_items")
                .select(detailColumns)
                .eq("id", value: id)
                .single()
                .execute()
                .value
            if let index = items.firstIndex(where: { $0.id == id }) {
                items[index] = item
                cache.replace(with: items)
            }
            return item
        } catch is CancellationError {
            return items.first(where: { $0.id == id })
        } catch {
            guard !Task.isCancelled else { return items.first(where: { $0.id == id }) }
            errorMessage = "Could not load the reader: \(error.localizedDescription)"
            return items.first(where: { $0.id == id })
        }
    }

    func folderName(for item: ContentItem) -> String? {
        guard let folderID = item.folderID else { return nil }
        return folders.first(where: { $0.id == folderID })?.name
    }

    func setFolder(for itemID: UUID, folderID: UUID?) async {
        do {
            let existingFolderID = items.first(where: { $0.id == itemID })?.folderID
            if let folderID {
                if let existingFolderID {
                    try await client.from("item_folders")
                        .update(FolderAssignmentUpdate(folderID: folderID))
                        .eq("item_id", value: itemID)
                        .eq("folder_id", value: existingFolderID)
                        .execute()
                } else {
                    let userID = try await client.auth.session.user.id
                    try await client.from("item_folders").insert(FolderAssignmentInsert(
                        itemID: itemID,
                        folderID: folderID,
                        userID: userID
                    )).execute()
                }
            } else if existingFolderID != nil {
                try await client.from("item_folders").delete().eq("item_id", value: itemID).execute()
            }
            await refresh()
            showNotice(folderID == nil ? "Category removed." : "Category updated.")
        } catch {
            errorMessage = "Could not update the category: \(error.localizedDescription)"
        }
    }

    func createFolder(name: String, color: String = "bg-[#c1ff00]", icon: String = "fa-folder") async -> Bool {
        let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanName.isEmpty else { return false }
        do {
            let userID = try await client.auth.session.user.id
            let _: QlipFolder = try await client
                .from("folders")
                .insert(FolderInsert(
                    userID: userID,
                    name: cleanName,
                    color: color,
                    icon: icon,
                    position: folders.count
                ))
                .select(folderColumns)
                .single()
                .execute()
                .value
            await refresh()
            showNotice("Category created.")
            return true
        } catch {
            errorMessage = "Could not create the folder: \(error.localizedDescription)"
            return false
        }
    }

    func updateFolder(_ folder: QlipFolder, name: String, color: String, icon: String) async -> Bool {
        let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanName.isEmpty else { return false }
        do {
            try await client.from("folders")
                .update(FolderUpdate(name: cleanName, color: color, icon: icon, position: folder.position))
                .eq("id", value: folder.id)
                .execute()
            await refresh()
            showNotice("Category saved.")
            return true
        } catch {
            errorMessage = "Could not update the category: \(error.localizedDescription)"
            return false
        }
    }

    func moveFolder(_ folder: QlipFolder, direction: Int) async {
        let ordered = folders.sorted { $0.position < $1.position }
        guard let current = ordered.firstIndex(where: { $0.id == folder.id }) else { return }
        let target = current + direction
        guard ordered.indices.contains(target) else { return }
        var moved = ordered
        moved.swapAt(current, target)
        do {
            for (position, entry) in moved.enumerated() {
                try await client.from("folders")
                    .update(FolderPositionUpdate(position: position))
                    .eq("id", value: entry.id)
                    .execute()
            }
            await refresh()
            showNotice("Categories reordered.")
        } catch {
            errorMessage = "Could not reorder categories: \(error.localizedDescription)"
        }
    }

    func deleteFolder(_ folder: QlipFolder) async {
        do {
            try await client.from("folders").delete().eq("id", value: folder.id).execute()
            await refresh()
            showNotice("Category deleted.")
        } catch {
            errorMessage = "Could not delete the folder: \(error.localizedDescription)"
        }
    }

    func togglePinned(_ item: ContentItem) async {
        let next = !item.isPinned
        let position = next ? ((items.compactMap(\.pinPosition).max() ?? -1) + 1) : nil
        do {
            try await client.from("content_items")
                .update(PinUpdate(isPinned: next, pinPosition: position))
                .eq("id", value: item.id)
                .execute()
            await refresh()
            showNotice(next ? "Added to Priority Vault." : "Removed from Priority Vault.")
        } catch {
            errorMessage = "Could not update Priority Vault: \(error.localizedDescription)"
        }
    }

    func movePinned(_ item: ContentItem, direction: Int) async {
        var ids = items
            .filter(\.isPinned)
            .sorted { ($0.pinPosition ?? .max) < ($1.pinPosition ?? .max) }
            .map(\.id)
        guard let index = ids.firstIndex(of: item.id) else { return }
        let target = index + direction
        guard ids.indices.contains(target) else { return }
        ids.swapAt(index, target)
        do {
            for (position, id) in ids.enumerated() {
                try await client.from("content_items")
                    .update(PinUpdate(isPinned: true, pinPosition: position))
                    .eq("id", value: id)
                    .execute()
            }
            await refresh()
            showNotice("Priority Vault order updated.")
        } catch {
            errorMessage = "Could not reorder Priority Vault: \(error.localizedDescription)"
        }
    }

    func toggleStarred(_ item: ContentItem) async {
        do {
            try await client.from("content_items")
                .update(StarUpdate(isStarred: !item.isStarred))
                .eq("id", value: item.id)
                .execute()
            await refresh()
            showNotice(item.isStarred ? "Removed star." : "Starred link.")
        } catch {
            errorMessage = "Could not update the item: \(error.localizedDescription)"
        }
    }

    func cycleReadStatus(_ item: ContentItem) async {
        let next = item.readStatus == "unread" ? "reading" : item.readStatus == "reading" ? "read" : "unread"
        do {
            try await client.from("content_items")
                .update(ReadStatusUpdate(readStatus: next))
                .eq("id", value: item.id)
                .execute()
            await refresh()
            showNotice("Reading status updated.")
        } catch {
            errorMessage = "Could not update reading status: \(error.localizedDescription)"
        }
    }

    func retry(_ item: ContentItem) async {
        do {
            let session = try await client.auth.session
            let functions = AppConfig.functionsClient(accessToken: session.accessToken)
            let _: RetryResponse = try await functions.invoke(
                "save-item",
                options: FunctionInvokeOptions(body: RetryRequest(retryItemID: item.id))
            )
            await refresh()
            showNotice("AI processing restarted.")
        } catch {
            errorMessage = "Could not retry AI processing: \(error.localizedDescription)"
        }
    }

    func translate(_ item: ContentItem, targetLanguage: String = "ar") async -> ItemTranslation? {
#if DEBUG
        if usesPreviewVault {
            return ItemTranslation(
                title: "كيف تستخدم الفرق الصغيرة الذكاء الاصطناعي دون فقدان وجهة نظرها",
                summary: "إطار عملي لاستخدام أدوات الذكاء الاصطناعي مع بقاء القرار النهائي لدى الإنسان.",
                keyPoints: ["ابدأ بالقرار وليس بالنموذج.", "اجعل مسؤول القرار واضحاً.", "سجّل ما لا يجب أن يقرره النظام."],
                body: "تبدأ الممارسة الجيدة للذكاء الاصطناعي بسؤال بسيط: ما القرار الذي نحاول اتخاذه؟ يجب أن تدعم الأداة هذا القرار، لا أن تستبدل الأشخاص المسؤولين عنه بهدوء.\n\nتحصل الفرق الصغيرة على أفضل قيمة عندما تحدد الحدود أولاً. دع الأتمتة تجمع السياق وتنظم المسودات وتعرض الخيارات، لكن اجعل مالك القرار واضحاً.\n\nالخطوة الأخيرة هي سجل قصير يوضح ما يستطيع النظام فعله وما لا يستطيع فعله ومن يراجعه. بهذه الطريقة تتحول التجربة إلى عادة موثوقة.",
                lang: targetLanguage,
                cached: true
            )
        }
#endif
        do {
            let session = try await client.auth.session
            // Long-timeout client: the translate function runs an LLM and can
            // take 60-120s on the first (uncached) translation of an item.
            let functions = AppConfig.aiFunctionsClient(accessToken: session.accessToken)
            let translated: ItemTranslation = try await functions.invoke(
                "translate",
                options: FunctionInvokeOptions(body: TranslateItemRequest(itemID: item.id, targetLanguage: targetLanguage))
            )
            return translated
        } catch {
            errorMessage = "Could not translate this item: \(error.localizedDescription)"
            return nil
        }
    }

    func updateItem(_ item: ContentItem, title: String, description: String, folderID: UUID?) async -> Bool {
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanDescription = description.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            try await client.from("content_items")
                .update(ItemEditUpdate(
                    title: cleanTitle.isEmpty ? nil : cleanTitle,
                    description: cleanDescription
                ))
                .eq("id", value: item.id)
                .execute()
            await setFolder(for: item.id, folderID: folderID)
            showNotice("Link details saved.")
            return true
        } catch {
            errorMessage = "Could not update this link: \(error.localizedDescription)"
            return false
        }
    }

    func deleteItem(_ item: ContentItem) async {
        do {
            try await client.from("content_items").delete().eq("id", value: item.id).execute()
            await refresh()
            showNotice("Link deleted.")
        } catch {
            errorMessage = "Could not delete the item: \(error.localizedDescription)"
        }
    }

    func createAPIKey(name: String) async -> String? {
        let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let key: String = try await client
                .rpc("create_api_key", params: ["key_name": cleanName.isEmpty ? "API key" : cleanName])
                .execute()
                .value
            await refresh()
            showNotice("API key created. Copy it before you leave this screen.")
            return key
        } catch {
            errorMessage = "Could not create the API key: \(error.localizedDescription)"
            return nil
        }
    }

    func revokeAPIKey(_ key: QlipAPIKey) async {
        do {
            try await client.from("api_keys")
                .update(APIKeyRevokeUpdate(revokedAt: .now))
                .eq("id", value: key.id)
                .execute()
            await refresh()
            showNotice("API key revoked.")
        } catch {
            errorMessage = "Could not revoke the API key: \(error.localizedDescription)"
        }
    }

    func deleteAPIKey(_ key: QlipAPIKey) async {
        do {
            try await client.from("api_keys").delete().eq("id", value: key.id).execute()
            await refresh()
            showNotice("API key deleted.")
        } catch {
            errorMessage = "Could not delete the API key: \(error.localizedDescription)"
        }
    }

    func applicationDidBecomeActive() async {
        guard isAuthenticated, !usesPreviewVault else { return }
        await flushPendingLinks()
        await refresh()
    }

    func applicationDidEnterBackground() {
        guard isAuthenticated, !usesPreviewVault else { return }
        BackgroundRefresh.schedule()
    }

    func performBackgroundRefresh() async {
        guard isAuthenticated, !usesPreviewVault else { return }
        await flushPendingLinks()
        await refresh()
        if queuedSaveCount > 0 { BackgroundRefresh.schedule(after: 15 * 60) }
    }

    private func flushPendingLinks() async {
        guard isAuthenticated, !queueFlushInFlight else { return }
        queueFlushInFlight = true
        defer {
            queueFlushInFlight = false
            queuedSaveCount = ShareInbox.pending().count
        }

        var didSave = false
        for capture in ShareInbox.pending() {
            do {
                let session = try await client.auth.session
                ShareInbox.cacheAccessToken(session.accessToken)
                let functions = AppConfig.functionsClient(accessToken: session.accessToken)
                let _: SaveLinkResponse = try await functions.invoke(
                    "save-item",
                    options: FunctionInvokeOptions(body: SaveLinkRequest(
                        url: capture.url.absoluteString,
                        savedVia: capture.savedVia,
                        destination: capture.destination,
                        folderID: capture.folderID,
                        note: capture.note
                    ))
                )
                ShareInbox.remove(capture)
                didSave = true
            } catch {
                // Keep the URL in the durable inbox. The user has already been
                // told it was captured, so retry quietly in the next foreground
                // or background refresh instead of surfacing a false failure.
                BackgroundRefresh.schedule(after: 15 * 60)
                break
            }
        }
        if didSave { await refresh() }
    }

    private func startRealtime() async {
        realtimeTask?.cancel()
        structureRealtimeTasks.forEach { $0.cancel() }
        structureRealtimeTasks = []
        guard let userID = try? await client.auth.session.user.id else { return }

        let channel = client.channel("qlip-content-items")
        let changes = channel.postgresChange(
            AnyAction.self,
            schema: "public",
            table: "content_items",
            filter: .eq("user_id", value: userID.uuidString)
        )
        do {
            try await channel.subscribeWithError()
        } catch {
            errorMessage = "Realtime connection failed: \(error.localizedDescription)"
            return
        }
        realtimeTask = Task { [weak self] in
            for await _ in changes {
                guard !Task.isCancelled else { break }
                self?.scheduleRealtimeRefresh()
            }
            await channel.unsubscribe()
        }

        // These tables shape the same vault but do not update a content_items
        // row. Give each its own lifecycle-managed channel so web changes to a
        // folder, assignment, or daily pick reach the phone immediately.
        for table in ["folders", "item_folders", "daily_picks"] {
            let structureChannel = client.channel("qlip-\(table)")
            let structureChanges = structureChannel.postgresChange(
                AnyAction.self,
                schema: "public",
                table: table,
                filter: .eq("user_id", value: userID.uuidString)
            )
            do {
                try await structureChannel.subscribeWithError()
                let task = Task { [weak self] in
                    for await _ in structureChanges {
                        guard !Task.isCancelled else { break }
                        self?.scheduleRealtimeRefresh()
                    }
                    await structureChannel.unsubscribe()
                }
                structureRealtimeTasks.append(task)
            } catch {
                await structureChannel.unsubscribe()
                errorMessage = "Realtime connection failed: \(error.localizedDescription)"
            }
        }
    }

    private func scheduleRealtimeRefresh() {
        realtimeRefreshTask?.cancel()
        realtimeRefreshTask = Task { [weak self] in
            do {
                try await Task.sleep(for: .milliseconds(450))
            } catch {
                return
            }
            guard !Task.isCancelled else { return }
            // Keep the debounce task disposable without cancelling an
            // already-started network refresh. Cancelling that refresh is what
            // previously surfaced Swift.CancellationError as an app alert.
            Task { @MainActor [weak self] in
                await self?.refresh()
            }
        }
    }

    private func normalizedURL(_ value: String) -> URL? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed), ["http", "https"].contains(url.scheme?.lowercased()) else { return nil }
        return url
    }

    private func showNotice(_ message: String) {
        noticeMessage = message
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(4))
            guard self?.noticeMessage == message else { return }
            self?.noticeMessage = nil
        }
    }
}

private struct FolderInsert: Encodable {
    let userID: UUID
    let name: String
    let color: String
    let icon: String
    let position: Int

    enum CodingKeys: String, CodingKey {
        case name, color, icon, position
        case userID = "user_id"
    }
}

private struct FolderUpdate: Encodable {
    let name: String
    let color: String
    let icon: String
    let position: Int
}

private struct FolderPositionUpdate: Encodable {
    let position: Int
}

private struct PinUpdate: Encodable {
    let isPinned: Bool
    let pinPosition: Int?

    enum CodingKeys: String, CodingKey {
        case isPinned = "is_pinned"
        case pinPosition = "pin_position"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(isPinned, forKey: .isPinned)
        if let pinPosition {
            try container.encode(pinPosition, forKey: .pinPosition)
        } else {
            try container.encodeNil(forKey: .pinPosition)
        }
    }
}

private struct StarUpdate: Encodable {
    let isStarred: Bool
    enum CodingKeys: String, CodingKey { case isStarred = "is_starred" }
}

private struct ReadStatusUpdate: Encodable {
    let readStatus: String
    enum CodingKeys: String, CodingKey { case readStatus = "read_status" }
}

private struct ItemEditUpdate: Encodable {
    let title: String?
    let description: String
}

private struct RetryRequest: Encodable {
    let retryItemID: UUID
    enum CodingKeys: String, CodingKey { case retryItemID = "retry_item_id" }
}

private struct RetryResponse: Decodable {
    let id: UUID
    let status: ProcessingStatus
    let retried: Bool
}

private struct APIKeyRevokeUpdate: Encodable {
    let revokedAt: Date
    enum CodingKeys: String, CodingKey { case revokedAt = "revoked_at" }
}
