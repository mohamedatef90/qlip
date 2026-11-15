import SwiftUI
import UIKit

struct ContentView: View {
    @EnvironmentObject private var store: QlipStore

    var body: some View {
        ZStack(alignment: .bottom) {
            QlipBackdrop()
            if store.isAuthenticated {
                QlipTabShell()
            } else {
                SignInView()
            }
            if let notice = store.noticeMessage {
                QlipNotice(message: notice)
                    .padding(.horizontal, QlipTheme.horizontalPadding)
                    .padding(.bottom, 88)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(20)
            }
        }
        .tint(QlipTheme.primary)
        .alert("Qlip", isPresented: Binding(
            get: { store.errorMessage != nil },
            set: { if !$0 { store.errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) { store.errorMessage = nil }
        } message: {
            Text(store.errorMessage ?? "")
        }
    }
}

private struct QlipNotice: View {
    let message: String

    var body: some View {
        Label(message, systemImage: "checkmark.circle.fill")
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(QlipTheme.foreground)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .frame(minHeight: 52)
            .background(QlipTheme.surfaceRaised.opacity(0.98), in: RoundedRectangle(cornerRadius: QlipTheme.controlRadius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: QlipTheme.controlRadius, style: .continuous)
                    .stroke(QlipTheme.success.opacity(0.45), lineWidth: 1)
            }
            .shadow(color: .black.opacity(0.22), radius: 18, y: 10)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Success. \(message)")
    }
}

private struct SignInView: View {
    @EnvironmentObject private var store: QlipStore
    @State private var email = ""
    @State private var password = ""
    @State private var showingPassword = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Spacer(minLength: 72)

                HStack(spacing: 12) {
                    QlipMark(size: 48)
                    Text("Qlip")
                        .font(.title.weight(.bold))
                        .foregroundStyle(QlipTheme.foreground)
                }

                Text("Your knowledge,\nready when you are.")
                    .font(.system(.largeTitle, design: .rounded, weight: .bold))
                    .tracking(-1.1)
                    .foregroundStyle(QlipTheme.foreground)
                    .padding(.top, 42)

                Text("Sign in to the same private vault you use on the web. Your saved links and AI insights stay in sync.")
                    .font(.body)
                    .foregroundStyle(QlipTheme.foregroundMuted)
                    .lineSpacing(5)
                    .padding(.top, 14)

                VStack(spacing: 16) {
                    QlipField(label: "Email", icon: "envelope", prompt: "you@example.com") {
                        TextField("you@example.com", text: $email)
                            .textContentType(.username)
                            .textInputAutocapitalization(.never)
                            .keyboardType(.emailAddress)
                    }

                    QlipField(label: "Password", icon: "lock", prompt: "Password") {
                        Group {
                            if showingPassword {
                                TextField("Password", text: $password)
                                    .textContentType(.password)
                            } else {
                                SecureField("Password", text: $password)
                                    .textContentType(.password)
                            }
                        }
                        Button { showingPassword.toggle() } label: {
                            Image(systemName: showingPassword ? "eye.slash" : "eye")
                                .frame(width: 44, height: 44)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(QlipTheme.foregroundMuted)
                        .accessibilityLabel(showingPassword ? "Hide password" : "Show password")
                    }
                }
                .padding(.top, 38)

                Button {
                    Task { await store.signIn(email: email, password: password) }
                } label: {
                    HStack(spacing: 10) {
                        if store.isLoading {
                            ProgressView().tint(QlipTheme.background)
                        }
                        Text(store.isLoading ? "Opening your vault…" : "Open my vault")
                            .font(.headline)
                        if !store.isLoading {
                            Image(systemName: "arrow.right")
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 54)
                    .foregroundStyle(QlipTheme.background)
                    .background(QlipTheme.brandGradient, in: RoundedRectangle(cornerRadius: QlipTheme.controlRadius, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(email.isEmpty || password.isEmpty || store.isLoading)
                .opacity(email.isEmpty || password.isEmpty ? 0.55 : 1)
                .padding(.top, 24)

                Button("Create a Qlip account") {
                    Task { await store.signUp(email: email, password: password) }
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(QlipTheme.primary)
                .frame(minHeight: 44)
                .disabled(email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || password.isEmpty || store.isLoading)
                .opacity(email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || password.isEmpty ? 0.55 : 1)
                .padding(.top, 8)

                VStack(spacing: 10) {
                    Label("Secured by your Qlip account", systemImage: "checkmark.shield")
                    Button("Forgot password?") { Task { await store.resetPassword(email: email) } }
                        .disabled(email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .font(.caption)
                .foregroundStyle(QlipTheme.foregroundMuted)
                .frame(maxWidth: .infinity)
                .padding(.top, 18)

                Spacer(minLength: 38)
            }
            .padding(.horizontal, 26)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
    }
}

private struct QlipField<Field: View>: View {
    let label: String
    let icon: String
    let prompt: String
    @ViewBuilder let field: () -> Field

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label.uppercased())
                .font(.caption2.weight(.bold))
                .tracking(1.3)
                .foregroundStyle(QlipTheme.foregroundMuted)
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .foregroundStyle(QlipTheme.primary)
                    .frame(width: 20)
                field()
                    .foregroundStyle(QlipTheme.foreground)
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 54)
            .background(QlipTheme.surfaceRaised.opacity(0.78), in: RoundedRectangle(cornerRadius: QlipTheme.controlRadius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: QlipTheme.controlRadius, style: .continuous)
                    .stroke(QlipTheme.border, lineWidth: 1)
            }
        }
    }
}

private struct QlipTabShell: View {
    @State private var showingSave = false
    // AppStorage (not State): switching appearance rebuilds the whole tree via
    // .id(appearance) in QlipApp, and plain @State would reset to the Vault tab
    // mid-Settings. Persisting the selection keeps the user where they were.
    @AppStorage("qlip-selected-tab-v2") private var selectedTab = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            VaultView(showingSave: $showingSave)
                .tabItem { Label("Vault", systemImage: "square.grid.2x2.fill") }
                .tag(0)

            LibraryView(showingSave: $showingSave)
                .tabItem { Label("Library", systemImage: "books.vertical.fill") }
                .tag(1)

            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape.fill") }
                .tag(2)
        }
        .sheet(isPresented: $showingSave) { SaveLinkView() }
    }
}

private struct VaultView: View {
    @EnvironmentObject private var store: QlipStore
    @Binding var showingSave: Bool
    @State private var query = ""
    @State private var navigationPath = NavigationPath()
    @State private var showingSignOutConfirmation = false
    @State private var showingVaultLayout = false
    @AppStorage("qlip-selected-tab-v2") private var selectedTab = 0
    @AppStorage(VaultSectionPreferences.orderKey) private var vaultSectionOrder = ""
    @AppStorage(VaultSectionPreferences.hiddenKey) private var hiddenVaultSections = ""

    /// Gradient monogram (first letter of the email) so the account button
    /// reads as *your* account, not an anonymous person icon.
    private var accountAvatar: some View {
        Group {
            if let initial = store.userEmail?.first.map({ String($0).uppercased() }) {
                Text(initial)
                    .font(.system(size: 17, weight: .bold, design: .rounded))
                    .foregroundStyle(QlipTheme.background)
                    .frame(width: 44, height: 44)
                    .background(QlipTheme.brandGradient, in: Circle())
                    .overlay(Circle().stroke(QlipTheme.border, lineWidth: 1))
            } else {
                Image(systemName: "person.crop.circle")
                    .font(.system(size: 22))
                    .foregroundStyle(QlipTheme.foregroundMuted)
                    .frame(width: 44, height: 44)
                    .background(QlipTheme.surface, in: Circle())
            }
        }
        .accessibilityLabel("Account")
    }

    private var filteredItems: [ContentItem] {
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return store.items }
        return store.items.filter {
            [$0.displayTitle, $0.displaySummary, $0.topic, $0.siteName]
                .compactMap { $0 }
                .joined(separator: " ")
                .localizedCaseInsensitiveContains(query)
        }
    }

    private var processingCount: Int {
        store.items.filter { ![.ready, .degraded, .failed].contains($0.status) }.count
    }

    private var bookmarks: [ContentItem] { filteredItems.filter { $0.isBookmark && !$0.isMobileSave } }
    private var reading: [ContentItem] { filteredItems.filter { $0.appearsInReading && $0.readStatus != "read" } }
    private var mobile: [ContentItem] { filteredItems.filter(\.isMobileSave) }
    private var library: [ContentItem] { filteredItems.filter { !$0.isBookmark } }
    private var dailyPicks: [ContentItem] { filteredItems.filter { store.dailyPickIDs.contains($0.id) } }
    private var priority: [ContentItem] {
        filteredItems
            .filter(\.isPinned)
            .sorted { ($0.pinPosition ?? .max) < ($1.pinPosition ?? .max) }
    }

    private var visibleVaultSections: [VaultSectionID] {
        VaultSectionPreferences.visibleSections(
            orderRaw: vaultSectionOrder,
            hiddenRaw: hiddenVaultSections
        )
    }

    var body: some View {
        NavigationStack(path: $navigationPath) {
            ZStack {
                QlipBackdrop()
                ScrollView {
                    LazyVStack(spacing: 18) {
                        vaultHeader
                        overviewCard
                        searchField

                        if store.items.isEmpty && store.isLoading {
                            LoadingVaultView()
                        } else if filteredItems.isEmpty {
                            EmptyVaultView(isSearching: !query.isEmpty) {
                                if query.isEmpty { showingSave = true } else { query = "" }
                            }
                        } else {
                            if query.isEmpty {
                                personalizedSections
                            } else {
                                VaultSection(title: "Search results", subtitle: "\(filteredItems.count) matches", items: filteredItems, limit: 20, onOpen: openReader)
                            }
                        }
                    }
                    .padding(.horizontal, QlipTheme.horizontalPadding)
                    .padding(.top, 14)
                    .padding(.bottom, QlipTheme.tabBarClearance)
                }
                .refreshable { await store.refresh() }
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: UUID.self) { ReaderDestination(itemID: $0) }
            .sheet(isPresented: $showingVaultLayout) {
                VaultLayoutSettingsView(
                    orderRaw: $vaultSectionOrder,
                    hiddenRaw: $hiddenVaultSections
                )
            }
        }
    }

    @ViewBuilder private var personalizedSections: some View {
        ForEach(visibleVaultSections) { section in
            switch section {
            case .priority:
                if !priority.isEmpty {
                    PriorityVaultSection(items: priority, onOpen: openReader)
                }
            case .continueReading:
                VaultSection(title: section.title, subtitle: section.subtitle, items: reading, onOpen: openReader)
            case .dailyPicks:
                VaultSection(title: section.title, subtitle: section.subtitle, items: dailyPicks, limit: 5, onOpen: openReader)
            case .fromPhone:
                VaultSection(title: section.title, subtitle: section.subtitle, items: mobile, onOpen: openReader)
            case .recentlyBookmarked:
                VaultSection(title: section.title, subtitle: section.subtitle, items: bookmarks, onOpen: openReader)
            case .freshLibrary:
                VaultSection(title: section.title, subtitle: section.subtitle, items: library, onOpen: openReader)
            }
        }
    }

    private func openReader(_ item: ContentItem) {
        navigationPath.append(item.id)
    }

    /// Jump to the Library tab with the given scope pre-selected.
    private func openLibrary(_ scope: String) {
        UserDefaults.standard.set(scope, forKey: "qlip-library-scope")
        selectedTab = 1
    }

    private var vaultHeader: some View {
        HStack(spacing: 11) {
            QlipMark(size: 40)
            VStack(alignment: .leading, spacing: 1) {
                Text("Qlip")
                    .font(.system(size: 22, weight: .bold, design: .rounded))
                    .foregroundStyle(QlipTheme.foreground)
                Text("KNOWLEDGE VAULT")
                    .font(.system(size: 9, weight: .bold))
                    .tracking(1.5)
                    .foregroundStyle(QlipTheme.foregroundMuted)
            }
            Spacer()
            Menu {
                Section(store.userEmail.map { "Signed in as \($0)" } ?? "Signed in") {
                    Button("Customize Vault", systemImage: "rectangle.3.group") {
                        showingVaultLayout = true
                    }
                    Button("Settings", systemImage: "gearshape") {
                        selectedTab = 2
                    }
                    Button("Sync now", systemImage: "arrow.triangle.2.circlepath") {
                        Task { await store.refresh(showSuccessNotice: true) }
                    }
                }
                Button("Sign out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
                    showingSignOutConfirmation = true
                }
            } label: {
                accountAvatar
            }
            .alert("Sign out of Qlip?", isPresented: $showingSignOutConfirmation) {
                Button("Sign out", role: .destructive) { Task { await store.signOut() } }
                Button("Cancel", role: .cancel) { }
            } message: {
                Text("Links you saved offline stay queued on this device.")
            }
            Button { showingSave = true } label: {
                Image(systemName: "plus")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(QlipTheme.background)
                    .frame(width: 44, height: 44)
                    .background(QlipTheme.brandGradient, in: Circle())
            }
            .accessibilityLabel("Save a link")
        }
    }

    private var overviewCard: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Your vault, in motion")
                        .font(.system(size: 22, weight: .bold, design: .rounded))
                        .foregroundStyle(QlipTheme.foreground)
                    Text("Every link becomes something you can understand and revisit.")
                        .font(.subheadline)
                        .foregroundStyle(QlipTheme.foregroundMuted)
                        .lineSpacing(3)
                }
                Spacer(minLength: 10)
                Image(systemName: "sparkles")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(QlipTheme.primary)
            }

            HStack(spacing: 12) {
                // Each stat deep-links into the matching Library scope (web parity).
                Button { openLibrary("Bookmarks") } label: {
                    Metric(value: "\(bookmarks.count)", label: "BOOKMARKS")
                }
                Rectangle().fill(QlipTheme.border).frame(width: 1, height: 35)
                Button { openLibrary("Reading") } label: {
                    Metric(value: "\(library.count)", label: "LIBRARY")
                }
                Rectangle().fill(QlipTheme.border).frame(width: 1, height: 35)
                Button { openLibrary("Reading") } label: {
                    Metric(value: "\(store.items.filter(\.isUnread).count)", label: "UNREAD")
                }
            }
            .buttonStyle(.plain)
            if processingCount > 0 {
                Label("Qlip is processing \(processingCount) item\(processingCount == 1 ? "" : "s")", systemImage: "sparkles")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(QlipTheme.warning)
            }
        }
        .padding(22)
        .background(
            LinearGradient(colors: [QlipTheme.surfaceRaised, QlipTheme.surface], startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: QlipTheme.heroRadius, style: .continuous)
        )
        .overlay(alignment: .topTrailing) {
            Circle().fill(QlipTheme.primary.opacity(0.08)).frame(width: 130).blur(radius: 10).offset(x: 32, y: -45).clipped()
        }
        .overlay {
            RoundedRectangle(cornerRadius: QlipTheme.heroRadius, style: .continuous)
                .stroke(QlipTheme.border.opacity(0.8), lineWidth: 1)
        }
    }

    private var searchField: some View {
        HStack(spacing: 12) {
            Image(systemName: "magnifyingglass").foregroundStyle(QlipTheme.foregroundMuted)
            TextField("Search your recent knowledge", text: $query)
                .textInputAutocapitalization(.never)
                .foregroundStyle(QlipTheme.foreground)
            if !query.isEmpty {
                Button { query = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(QlipTheme.foregroundMuted)
                }
            }
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 50)
        .background(QlipTheme.surface, in: RoundedRectangle(cornerRadius: QlipTheme.controlRadius, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: QlipTheme.controlRadius).stroke(QlipTheme.border.opacity(0.75)) }
    }

}

private enum VaultSectionID: String, CaseIterable, Identifiable, Hashable {
    case priority
    case continueReading
    case dailyPicks
    case fromPhone
    case recentlyBookmarked
    case freshLibrary

    var id: String { rawValue }

    var title: String {
        switch self {
        case .priority: "Priority Vault"
        case .continueReading: "Continue reading"
        case .dailyPicks: "Today's Picks"
        case .fromPhone: "From your phone"
        case .recentlyBookmarked: "Recently bookmarked"
        case .freshLibrary: "Fresh in your Library"
        }
    }

    var subtitle: String {
        switch self {
        case .priority: "Your pinned links"
        case .continueReading: "Pick up where you left off"
        case .dailyPicks: "Worth another look"
        case .fromPhone: "Captured in the Qlip app"
        case .recentlyBookmarked: "Websites ready when you need them"
        case .freshLibrary: "Articles, video and social"
        }
    }

    var icon: String {
        switch self {
        case .priority: "pin.fill"
        case .continueReading: "book.closed"
        case .dailyPicks: "sparkles"
        case .fromPhone: "iphone"
        case .recentlyBookmarked: "bookmark.fill"
        case .freshLibrary: "books.vertical.fill"
        }
    }
}

private enum VaultSectionPreferences {
    static let orderKey = "qlip-vault-section-order-v1"
    static let hiddenKey = "qlip-vault-hidden-sections-v1"
    static let defaultOrder = VaultSectionID.allCases

    static func orderedSections(from raw: String) -> [VaultSectionID] {
        guard
            let data = raw.data(using: .utf8),
            let savedIDs = try? JSONDecoder().decode([String].self, from: data)
        else { return defaultOrder }

        let saved = savedIDs.compactMap(VaultSectionID.init(rawValue:))
        let missing = defaultOrder.filter { !saved.contains($0) }
        return saved + missing
    }

    static func hiddenSections(from raw: String) -> Set<VaultSectionID> {
        guard
            let data = raw.data(using: .utf8),
            let savedIDs = try? JSONDecoder().decode([String].self, from: data)
        else { return [] }
        return Set(savedIDs.compactMap(VaultSectionID.init(rawValue:)))
    }

    static func visibleSections(orderRaw: String, hiddenRaw: String) -> [VaultSectionID] {
        let hidden = hiddenSections(from: hiddenRaw)
        return orderedSections(from: orderRaw).filter { !hidden.contains($0) }
    }

    static func encoded(_ sections: [VaultSectionID]) -> String {
        guard let data = try? JSONEncoder().encode(sections.map(\.rawValue)) else { return "" }
        return String(decoding: data, as: UTF8.self)
    }

    static func encoded(_ sections: Set<VaultSectionID>) -> String {
        encoded(sections.sorted { $0.rawValue < $1.rawValue })
    }
}

private struct VaultLayoutSettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var orderRaw: String
    @Binding var hiddenRaw: String
    @State private var ordered = VaultSectionPreferences.defaultOrder
    @State private var hidden: Set<VaultSectionID> = []

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Choose what appears on your Vault, then use Edit to drag sections into the order you want.")
                        .font(.footnote)
                        .foregroundStyle(QlipTheme.foregroundMuted)
                }

                Section("Vault sections") {
                    ForEach(ordered) { section in
                        Toggle(isOn: visibilityBinding(for: section)) {
                            Label(section.title, systemImage: section.icon)
                                .foregroundStyle(QlipTheme.foreground)
                        }
                        .tint(QlipTheme.primary)
                    }
                    .onMove { source, destination in
                        ordered.move(fromOffsets: source, toOffset: destination)
                        persistOrder()
                    }
                }

                Section {
                    Button("Reset Vault layout", role: .destructive) {
                        ordered = VaultSectionPreferences.defaultOrder
                        hidden = []
                        persistOrder()
                        persistHidden()
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(QlipTheme.background)
            .navigationTitle("Customize Vault")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    EditButton()
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationBackground(QlipTheme.background)
        .onAppear {
            ordered = VaultSectionPreferences.orderedSections(from: orderRaw)
            hidden = VaultSectionPreferences.hiddenSections(from: hiddenRaw)
        }
    }

    private func visibilityBinding(for section: VaultSectionID) -> Binding<Bool> {
        Binding(
            get: { !hidden.contains(section) },
            set: { isVisible in
                if isVisible {
                    hidden.remove(section)
                } else {
                    hidden.insert(section)
                }
                persistHidden()
            }
        )
    }

    private func persistOrder() {
        orderRaw = VaultSectionPreferences.encoded(ordered)
    }

    private func persistHidden() {
        hiddenRaw = VaultSectionPreferences.encoded(hidden)
    }
}

private struct VaultSection: View {
    let title: String
    let subtitle: String
    let items: [ContentItem]
    var limit = 4
    let onOpen: (ContentItem) -> Void

    var body: some View {
        guard !items.isEmpty else { return AnyView(EmptyView()) }
        return AnyView(
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.title3.weight(.bold))
                        .foregroundStyle(QlipTheme.foreground)
                    Text(subtitle)
                        .font(.footnote)
                        .foregroundStyle(QlipTheme.foregroundMuted)
                }
                ForEach(Array(items.prefix(limit))) { item in
                    ContentItemLink(item: item, onOpen: onOpen)
                }
            }
        )
    }
}

private struct ContentItemLink: View {
    @EnvironmentObject private var store: QlipStore
    let item: ContentItem
    let onOpen: (ContentItem) -> Void
    @State private var showingEditor = false
    @State private var showingDeleteConfirmation = false
    @State private var isRetrying = false

    var body: some View {
        VStack(spacing: 8) {
            Group {
                if item.opensInReader {
                    Button { onOpen(item) } label: { VaultCard(item: item) }
                } else {
                    Link(destination: item.url) { VaultCard(item: item) }
                }
            }
            .buttonStyle(.plain)
            .overlay(alignment: .topTrailing) {
                CardEditButton { showingEditor = true }
                    .padding(10)
            }
            .contextMenu { contextActions }
        }
        .sheet(isPresented: $showingEditor) { ItemEditorSheet(item: item) }
        .alert("Delete this link?", isPresented: $showingDeleteConfirmation) {
            Button("Delete", role: .destructive) { Task { await store.deleteItem(item) } }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("This removes the link and its AI notes from your vault.")
        }
    }

    @ViewBuilder private var contextActions: some View {
        Link(destination: item.url) { Label("Open original", systemImage: "safari") }
        Button { Task { await store.togglePinned(item) } } label: {
            Label(item.isPinned ? "Remove from Priority Vault" : "Add to Priority Vault", systemImage: item.isPinned ? "pin.slash" : "pin")
        }
        if item.isPinned {
            Button { Task { await store.movePinned(item, direction: -1) } } label: { Label("Move earlier", systemImage: "arrow.left") }
            Button { Task { await store.movePinned(item, direction: 1) } } label: { Label("Move later", systemImage: "arrow.right") }
        }
        Button { showingEditor = true } label: { Label("Edit details", systemImage: "pencil") }
        Button { Task { await store.toggleStarred(item) } } label: {
            Label(item.isStarred ? "Unstar" : "Star", systemImage: item.isStarred ? "star.slash" : "star")
        }
        Button { Task { await store.cycleReadStatus(item) } } label: { Label("Change reading status", systemImage: "checkmark.circle") }
        Menu("Move to category") {
            Button("AI chooses / Unfiled") { Task { await store.setFolder(for: item.id, folderID: nil) } }
            ForEach(store.folders) { folder in
                Button(folder.name) { Task { await store.setFolder(for: item.id, folderID: folder.id) } }
            }
        }
        Button(action: retryAI) { Label("Retry AI", systemImage: "arrow.clockwise") }
            .disabled(isRetrying)
        Button(role: .destructive) { showingDeleteConfirmation = true } label: { Label("Delete", systemImage: "trash") }
    }

    private func retryAI() {
        guard !isRetrying else { return }
        isRetrying = true
        Task {
            await store.retry(item)
            isRetrying = false
        }
    }

}

private struct LinkActionButtonStyle: ButtonStyle {
    let tint: Color

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.caption.weight(.semibold))
            .foregroundStyle(tint)
            .lineLimit(1)
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(tint.opacity(configuration.isPressed ? 0.22 : 0.12), in: Capsule())
            .overlay { Capsule().stroke(tint.opacity(0.18), lineWidth: 1) }
            .opacity(configuration.isPressed ? 0.82 : 1)
    }
}

private struct CardEditButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "pencil")
                .font(.caption.weight(.bold))
                .foregroundStyle(QlipTheme.foreground)
                .frame(width: 36, height: 36)
                .background(QlipTheme.surfaceRaised.opacity(0.96), in: Circle())
                .overlay { Circle().stroke(QlipTheme.border, lineWidth: 1) }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Edit link")
    }
}

private struct PriorityVaultSection: View {
    let items: [ContentItem]
    let onOpen: (ContentItem) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("Priority Vault", systemImage: "pin.fill")
                    .font(.system(size: 21, weight: .bold, design: .rounded))
                    .foregroundStyle(QlipTheme.foreground)
                Spacer()
                Text("\(items.count)")
                    .font(.caption.bold())
                    .foregroundStyle(QlipTheme.foregroundMuted)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 12) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                        PriorityLinkCard(item: item, rank: index + 1, onOpen: onOpen)
                            .frame(width: 304)
                    }
                }
            }
        }
    }
}

private struct PriorityLinkCard: View {
    @EnvironmentObject private var store: QlipStore
    let item: ContentItem
    let rank: Int
    let onOpen: (ContentItem) -> Void
    @State private var showingEditor = false
    @State private var showingDeleteConfirmation = false

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            Group {
                if item.opensInReader {
                    Button { onOpen(item) } label: { priorityContent }
                } else {
                    Link(destination: item.url) { priorityContent }
                }
            }
            .buttonStyle(.plain)
        }
        .padding(14)
        .qlipCard()
        .overlay(alignment: .topTrailing) {
            CardEditButton { showingEditor = true }
                .padding(10)
        }
        .sheet(isPresented: $showingEditor) { ItemEditorSheet(item: item) }
        .alert("Delete this link?", isPresented: $showingDeleteConfirmation) {
            Button("Delete", role: .destructive) { Task { await store.deleteItem(item) } }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("This removes the link and its AI notes from your vault.")
        }
    }

    private var priorityContent: some View {
        VStack(alignment: .leading, spacing: 11) {
            ZStack(alignment: .topLeading) {
                if item.isSocial {
                    SocialMediaPreview(url: item.thumbnailURL, sourceType: item.sourceType, height: 108, cornerRadius: 14)
                } else {
                    LinearGradient(colors: [QlipTheme.primary.opacity(0.28), QlipTheme.surfaceRaised], startPoint: .topLeading, endPoint: .bottomTrailing)
                        .frame(height: 108)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .overlay(alignment: .bottomTrailing) {
                            Image(systemName: "pin.fill")
                                .font(.system(size: 32, weight: .semibold))
                                .foregroundStyle(QlipTheme.primary.opacity(0.8))
                                .padding(13)
                        }
                }
                Text("PRIORITY #\(rank)")
                    .font(.system(size: 10, weight: .bold))
                    .tracking(1)
                    .foregroundStyle(QlipTheme.background)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 6)
                    .background(QlipTheme.primary, in: Capsule())
                    .padding(10)
            }
            Text(item.displayTitle)
                .font(.system(size: 17, weight: .bold, design: .rounded))
                .foregroundStyle(QlipTheme.foreground)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
            Text(item.displaySummary)
                .font(.footnote)
                .foregroundStyle(QlipTheme.foregroundMuted)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
            HStack {
                Label(item.readStatus == "reading" ? "Continue" : "Open", systemImage: "book.closed")
                Spacer()
                Text(item.siteName ?? item.url.host() ?? "")
                    .lineLimit(1)
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(QlipTheme.primary)
        }
    }
}

private struct LibraryView: View {
    private enum Scope: String, CaseIterable, Identifiable {
        case mobile = "Mobile"
        case bookmarks = "Bookmarks"
        case reading = "Reading"
        var id: Self { self }
    }

    @EnvironmentObject private var store: QlipStore
    @Binding var showingSave: Bool
    // Backed by UserDefaults so the Vault stat tiles can deep-link into a scope
    // ("qlip-library-scope") before switching to this tab.
    @AppStorage("qlip-library-scope") private var scopeRaw = Scope.reading.rawValue
    @State private var query = ""
    @State private var topic: String?
    @State private var sourceType: String?
    @State private var folderID: UUID?
    @State private var showingFilters = false
    @State private var navigationPath = NavigationPath()

    private var scope: Scope { Scope(rawValue: scopeRaw) ?? .reading }

    private var topics: [String] {
        Array(Set(store.items.compactMap(\.topic).filter { !$0.isEmpty })).sorted()
    }

    private var sourceTypes: [String] {
        Array(Set(store.items.map(\.sourceType))).sorted()
    }

    private var items: [ContentItem] {
        store.items.filter { item in
            let matchesScope: Bool
            switch scope {
            case .mobile: matchesScope = item.isMobileSave
            case .bookmarks: matchesScope = item.isBookmark && !item.isMobileSave
            case .reading: matchesScope = item.appearsInReading
            }
            let matchesQuery = query.isEmpty || [item.displayTitle, item.displaySummary, item.topic, item.siteName]
                .compactMap { $0 }
                .joined(separator: " ")
                .localizedCaseInsensitiveContains(query)
            return matchesScope
                && matchesQuery
                && (topic == nil || item.topic == topic)
                && (sourceType == nil || item.sourceType == sourceType)
                && (folderID == nil || item.folderID == folderID)
        }
    }

    var body: some View {
        NavigationStack(path: $navigationPath) {
            ZStack {
                QlipBackdrop()
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        Text("Library")
                            .font(.largeTitle.weight(.bold))
                            .foregroundStyle(QlipTheme.foreground)
                        Text("A quiet place for every link you want to keep.")
                            .font(.subheadline)
                            .foregroundStyle(QlipTheme.foregroundMuted)

                        Picker("Library section", selection: $scopeRaw) {
                            ForEach(Scope.allCases) { Text($0.rawValue).tag($0.rawValue) }
                        }
                        .pickerStyle(.segmented)

                        QlipSearchField(query: $query, prompt: "Search this section")

                        HStack {
                            Label("\(items.count) items", systemImage: "tray.full")
                            Spacer()
                            if topic != nil || sourceType != nil || folderID != nil {
                                Button("Clear") { topic = nil; sourceType = nil; folderID = nil }
                            }
                        }
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(QlipTheme.foregroundMuted)

                        if items.isEmpty {
                            LibraryEmptyState(scope: scope.rawValue)
                        } else {
                            ForEach(items) { item in
                                ContentItemLink(item: item) { navigationPath.append($0.id) }
                            }
                        }
                    }
                    .padding(.horizontal, QlipTheme.horizontalPadding)
                    .padding(.top, 18)
                    .padding(.bottom, QlipTheme.tabBarClearance)
                }
                .refreshable { await store.refresh() }
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showingFilters = true } label: {
                        Image(systemName: topic != nil || sourceType != nil || folderID != nil ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                    }
                    .accessibilityLabel("Filter library")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showingSave = true } label: { Image(systemName: "plus") }
                        .accessibilityLabel("Save a link")
                }
            }
            .navigationDestination(for: UUID.self) { ReaderDestination(itemID: $0) }
            .sheet(isPresented: $showingFilters) {
                LibraryFilterSheet(
                    topics: topics,
                    sourceTypes: sourceTypes,
                    folders: store.folders,
                    topic: $topic,
                    sourceType: $sourceType,
                    folderID: $folderID
                )
            }
        }
    }
}

private struct QlipSearchField: View {
    @Binding var query: String
    let prompt: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "magnifyingglass").foregroundStyle(QlipTheme.foregroundMuted)
            TextField(prompt, text: $query)
                .textInputAutocapitalization(.never)
                .foregroundStyle(QlipTheme.foreground)
            if !query.isEmpty {
                Button { query = "" } label: { Image(systemName: "xmark.circle.fill") }
                    .foregroundStyle(QlipTheme.foregroundMuted)
            }
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 50)
        .background(QlipTheme.surface, in: RoundedRectangle(cornerRadius: QlipTheme.controlRadius, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: QlipTheme.controlRadius).stroke(QlipTheme.border.opacity(0.75)) }
    }
}

private struct LibraryFilterSheet: View {
    @Environment(\.dismiss) private var dismiss
    let topics: [String]
    let sourceTypes: [String]
    let folders: [QlipFolder]
    @Binding var topic: String?
    @Binding var sourceType: String?
    @Binding var folderID: UUID?

    var body: some View {
        NavigationStack {
            Form {
                Section("Topic") {
                    Picker("Topic", selection: $topic) {
                        Text("All topics").tag(String?.none)
                        ForEach(topics, id: \.self) { Text($0).tag(Optional($0)) }
                    }
                }
                Section("Source") {
                    Picker("Source", selection: $sourceType) {
                        Text("All sources").tag(String?.none)
                        ForEach(sourceTypes, id: \.self) { Text($0.capitalized).tag(Optional($0)) }
                    }
                }
                Section("Category") {
                    Picker("Category", selection: $folderID) {
                        Text("All categories").tag(UUID?.none)
                        ForEach(folders) { folder in
                            Text(folder.name).tag(Optional(folder.id))
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(QlipTheme.background)
            .navigationTitle("Filters")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Reset") { topic = nil; sourceType = nil; folderID = nil }
                }
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .presentationDetents([.medium])
        .presentationBackground(QlipTheme.background)
    }
}

private struct LibraryEmptyState: View {
    let title: String
    let message: String
    var icon = "bookmark"

    init(scope: String) {
        title = "Nothing in \(scope) yet"
        message = "Use the + button to capture a link, or change the filters."
    }

    init(title: String, message: String, icon: String) {
        self.title = title
        self.message = message
        self.icon = icon
    }

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(QlipTheme.primary)
            Text(title)
                .font(.headline)
                .foregroundStyle(QlipTheme.foreground)
            Text(message)
                .font(.footnote)
                .foregroundStyle(QlipTheme.foregroundMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(30)
        .qlipCard()
    }
}

private struct SettingsView: View {
    @EnvironmentObject private var store: QlipStore
    @AppStorage("qlip-appearance") private var appearance = QlipAppearance.default.rawValue
    @AppStorage(VaultSectionPreferences.orderKey) private var vaultSectionOrder = ""
    @AppStorage(VaultSectionPreferences.hiddenKey) private var hiddenVaultSections = ""
    @State private var showingSignOutConfirmation = false
    @State private var showingVaultLayout = false

    var body: some View {
        NavigationStack {
            ZStack {
                QlipBackdrop()
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        Text("Settings")
                            .font(.largeTitle.weight(.bold))
                            .foregroundStyle(QlipTheme.foreground)

                        settingsCard("Appearance", icon: "paintpalette.fill") {
                            Picker("Appearance", selection: $appearance) {
                                ForEach(QlipAppearance.allCases) { option in
                                    Label(option.title, systemImage: option.icon).tag(option.rawValue)
                                }
                            }
                            .pickerStyle(.segmented)
                            Text("Uses the same Magic Black, Professional and Playful choices as Qlip on the web.")
                                .foregroundStyle(QlipTheme.foregroundMuted)
                        }

                        settingsCard("Sync", icon: "arrow.triangle.2.circlepath") {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(store.lastSyncedAt.map { "Last synced \($0.formatted(date: .abbreviated, time: .shortened))" } ?? "Syncing your vault when the app opens")
                                Text(store.queuedSaveCount == 0 ? "All captured links are safely handed to Qlip." : "\(store.queuedSaveCount) link\(store.queuedSaveCount == 1 ? "" : "s") queued for upload.")
                                    .foregroundStyle(QlipTheme.foregroundMuted)
                            }
                            Button { Task { await store.refresh(showSuccessNotice: true) } } label: {
                                Label(store.isLoading ? "Syncing…" : "Sync now", systemImage: "arrow.clockwise")
                                    .frame(maxWidth: .infinity)
                                    .frame(height: 46)
                                    .foregroundStyle(QlipTheme.background)
                                    .background(QlipTheme.primary, in: RoundedRectangle(cornerRadius: QlipTheme.controlRadius, style: .continuous))
                            }
                            .buttonStyle(.plain)
                            .disabled(store.isLoading)
                        }

                        settingsCard("Background capture", icon: "checkmark.shield.fill") {
                            Text("Capture is durable. If you switch apps before a link uploads, Qlip retries it in the background. AI processing continues on the server after the link reaches Qlip.")
                                .foregroundStyle(QlipTheme.foregroundMuted)
                                .lineSpacing(4)
                        }

                        settingsCard("Vault layout", icon: "rectangle.3.group") {
                            Text("Choose the sections you see on Vault and put them in the order that fits how you revisit links.")
                                .foregroundStyle(QlipTheme.foregroundMuted)
                            Button { showingVaultLayout = true } label: {
                                Label("Customize Vault", systemImage: "slider.horizontal.3")
                                    .frame(maxWidth: .infinity)
                                    .frame(height: 46)
                                    .foregroundStyle(QlipTheme.background)
                                    .background(QlipTheme.primary, in: RoundedRectangle(cornerRadius: QlipTheme.controlRadius, style: .continuous))
                            }
                            .buttonStyle(.plain)
                        }

                        settingsCard("Categories", icon: "folder.fill") {
                            Text("\(store.folders.count) folders sync with the web app and appear as Library filters and share-extension choices.")
                                .foregroundStyle(QlipTheme.foregroundMuted)
                            settingsLink("Manage categories", icon: "folder.badge.gearshape") {
                                FolderSettingsView()
                            }
                        }

                        settingsCard("MCP Access", icon: "terminal.fill") {
                            Text("Create and revoke the same personal agent keys available in Qlip on the web.")
                                .foregroundStyle(QlipTheme.foregroundMuted)
                            settingsLink("Manage agent API keys", icon: "key.fill") {
                                APIKeySettingsView()
                            }
                        }

                        settingsCard("Account", icon: "person.crop.circle") {
                            Button(role: .destructive) { showingSignOutConfirmation = true } label: {
                                Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .frame(minHeight: 44)
                            }
                        }
                    }
                    .padding(.horizontal, QlipTheme.horizontalPadding)
                    .padding(.top, 18)
                    .padding(.bottom, QlipTheme.tabBarClearance)
                }
            }
        }
        .alert("Sign out of Qlip?", isPresented: $showingSignOutConfirmation) {
            Button("Sign out", role: .destructive) { Task { await store.signOut() } }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("Your saved links stay in Qlip, but this device will stop syncing until you sign in again.")
        }
        .sheet(isPresented: $showingVaultLayout) {
            VaultLayoutSettingsView(
                orderRaw: $vaultSectionOrder,
                hiddenRaw: $hiddenVaultSections
            )
        }
    }

    private func settingsCard<Content: View>(_ title: String, icon: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Label(title, systemImage: icon)
                .font(.headline)
                .foregroundStyle(QlipTheme.foreground)
            content()
                .font(.subheadline)
        }
        .padding(18)
        .qlipCard()
    }

    private func settingsLink<Destination: View>(_ title: String, icon: String, @ViewBuilder destination: () -> Destination) -> some View {
        NavigationLink(destination: destination) {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .frame(width: 20)
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.bold))
            }
            .foregroundStyle(QlipTheme.primary)
            .padding(.horizontal, 14)
            .frame(minHeight: 48)
            .background(QlipTheme.primary.opacity(0.10), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(QlipTheme.primary.opacity(0.18), lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
    }
}

private struct FolderSettingsView: View {
    @EnvironmentObject private var store: QlipStore
    @State private var name = ""
    @State private var color = qlipFolderColors[0]
    @State private var icon = qlipFolderIcons[0].0
    @State private var editingFolder: QlipFolder?
    @State private var folderPendingDeletion: QlipFolder?
    @State private var isCreating = false

    var body: some View {
        List {
            Section("Create category") {
                TextField("Category name", text: $name)
                Picker("Color", selection: $color) {
                    ForEach(qlipFolderColors, id: \.self) { value in
                        Label(folderColorName(value), systemImage: "circle.fill")
                            .foregroundStyle(folderColor(value))
                            .tag(value)
                    }
                }
                Picker("Icon", selection: $icon) {
                    ForEach(qlipFolderIcons, id: \.0) { value, symbol in
                        Label(folderIconName(value), systemImage: symbol).tag(value)
                    }
                }
                Button(isCreating ? "Adding…" : "Add category") {
                    let newName = name
                    isCreating = true
                    Task {
                        if await store.createFolder(name: newName, color: color, icon: icon) {
                            name = ""
                        }
                        isCreating = false
                    }
                }
                .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isCreating)
            }
            Section("Synced categories") {
                ForEach(store.folders.sorted { $0.position < $1.position }) { folder in
                    HStack {
                        Image(systemName: folderSFSymbol(folder.icon))
                            .foregroundStyle(folderColor(folder.color))
                            .frame(width: 24)
                        Text(folder.name)
                        Spacer()
                        Text("\(store.items.filter { $0.folderID == folder.id }.count)")
                            .foregroundStyle(QlipTheme.foregroundMuted)
                        Menu {
                            Button("Edit", systemImage: "pencil") { editingFolder = folder }
                            Button("Move earlier", systemImage: "arrow.up") {
                                Task { await store.moveFolder(folder, direction: -1) }
                            }
                            Button("Move later", systemImage: "arrow.down") {
                                Task { await store.moveFolder(folder, direction: 1) }
                            }
                            Button("Delete", systemImage: "trash", role: .destructive) {
                                folderPendingDeletion = folder
                            }
                        } label: {
                            Image(systemName: "ellipsis.circle")
                        }
                    }
                    .swipeActions {
                        Button("Edit") { editingFolder = folder }.tint(QlipTheme.primary)
                        Button("Delete", role: .destructive) { folderPendingDeletion = folder }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(QlipTheme.background)
        .navigationTitle("Categories")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $editingFolder) { folder in
            FolderEditorSheet(folder: folder)
        }
        .alert("Delete category?", isPresented: Binding(
            get: { folderPendingDeletion != nil },
            set: { if !$0 { folderPendingDeletion = nil } }
        ), presenting: folderPendingDeletion) { folder in
            Button("Delete", role: .destructive) { Task { await store.deleteFolder(folder) } }
            Button("Cancel", role: .cancel) { }
        } message: { folder in
            Text("Items in \(folder.name) will remain in your vault but become unfiled.")
        }
        .toolbar(.hidden, for: .tabBar)
    }
}

private let qlipFolderColors = [
    "bg-[#c1ff00]", "bg-blue-400", "bg-pink-400", "bg-purple-400",
    "bg-orange-400", "bg-zinc-100", "bg-teal-400", "bg-emerald-400"
]

private let qlipFolderIcons = [
    ("fa-robot", "cpu"), ("fa-sparkles", "sparkles"), ("fa-bolt", "bolt.fill"),
    ("fa-briefcase", "briefcase.fill"), ("fa-palette", "paintpalette.fill"),
    ("fa-code", "chevron.left.forwardslash.chevron.right"), ("fa-play", "play.fill"),
    ("fa-newspaper", "newspaper.fill"), ("fa-graduation-cap", "graduationcap.fill"),
    ("fa-heart", "heart.fill"), ("fa-link", "link")
]

private func folderColor(_ value: String?) -> Color {
    switch value {
    case "bg-blue-400": .blue
    case "bg-pink-400": .pink
    case "bg-purple-400": .purple
    case "bg-orange-400": .orange
    case "bg-zinc-100": Color(white: 0.9)
    case "bg-teal-400": .teal
    case "bg-emerald-400": .green
    default: QlipTheme.primary
    }
}

private func folderColorName(_ value: String) -> String {
    switch value {
    case "bg-blue-400": "Blue"
    case "bg-pink-400": "Pink"
    case "bg-purple-400": "Purple"
    case "bg-orange-400": "Orange"
    case "bg-zinc-100": "Silver"
    case "bg-teal-400": "Teal"
    case "bg-emerald-400": "Emerald"
    default: "Qlip Lime"
    }
}

private func folderSFSymbol(_ value: String?) -> String {
    qlipFolderIcons.first(where: { $0.0 == value })?.1 ?? "folder.fill"
}

private func folderIconName(_ value: String) -> String {
    value.replacingOccurrences(of: "fa-", with: "").replacingOccurrences(of: "-", with: " ").capitalized
}

private struct FolderEditorSheet: View {
    @EnvironmentObject private var store: QlipStore
    @Environment(\.dismiss) private var dismiss
    let folder: QlipFolder
    @State private var name: String
    @State private var color: String
    @State private var icon: String
    @State private var isSaving = false

    init(folder: QlipFolder) {
        self.folder = folder
        _name = State(initialValue: folder.name)
        _color = State(initialValue: folder.color ?? qlipFolderColors[0])
        _icon = State(initialValue: folder.icon ?? qlipFolderIcons[0].0)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Category") { TextField("Name", text: $name) }
                Section("Color") {
                    Picker("Color", selection: $color) {
                        ForEach(qlipFolderColors, id: \.self) { value in
                            Label(folderColorName(value), systemImage: "circle.fill")
                                .foregroundStyle(folderColor(value)).tag(value)
                        }
                    }
                    .pickerStyle(.inline)
                }
                Section("Icon") {
                    Picker("Icon", selection: $icon) {
                        ForEach(qlipFolderIcons, id: \.0) { value, symbol in
                            Label(folderIconName(value), systemImage: symbol).tag(value)
                        }
                    }
                    .pickerStyle(.inline)
                }
            }
            .scrollContentBackground(.hidden)
            .background(QlipTheme.background)
            .navigationTitle("Edit category")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Save") {
                        isSaving = true
                        Task {
                            let didSave = await store.updateFolder(folder, name: name, color: color, icon: icon)
                            isSaving = false
                            if didSave { dismiss() }
                        }
                    }
                    .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSaving)
                }
            }
        }
        .presentationDetents([.large])
        .presentationBackground(QlipTheme.background)
    }
}

private struct APIKeySettingsView: View {
    @EnvironmentObject private var store: QlipStore
    @State private var name = ""
    @State private var revealedKey: String?
    @State private var isCreating = false
    @State private var pendingKeyAction: PendingAPIKeyAction?

    private let endpoint = "https://sjskpjgepbvblojohtlr.supabase.co/functions/v1/mcp"

    var body: some View {
        ZStack {
            QlipBackdrop()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Personal keys let MCP-compatible assistants save, search and organize your vault. Each key is scoped to your Qlip account.")
                        .font(.subheadline)
                        .foregroundStyle(QlipTheme.foregroundMuted)
                        .lineSpacing(4)

                    if let revealedKey {
                        VStack(alignment: .leading, spacing: 12) {
                            Label("Copy this key now", systemImage: "exclamationmark.triangle.fill")
                                .font(.headline).foregroundStyle(QlipTheme.warning)
                            Text("It is shown once and Qlip stores only its hash.")
                                .font(.caption).foregroundStyle(QlipTheme.foregroundMuted)
                            Text(revealedKey)
                                .font(.system(.caption, design: .monospaced))
                                .textSelection(.enabled)
                                .foregroundStyle(QlipTheme.foreground)
                                .padding(12)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(QlipTheme.surfaceRaised, in: RoundedRectangle(cornerRadius: 12))
                            Button {
                                UIPasteboard.general.string = revealedKey
                            } label: {
                                Label("Copy key", systemImage: "doc.on.doc")
                                    .frame(maxWidth: .infinity).frame(height: 44)
                            }
                            .buttonStyle(.borderedProminent)
                        }
                        .padding(18)
                        .qlipCard()
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        TextField("Key name, e.g. Codex", text: $name)
                            .textInputAutocapitalization(.words)
                            .padding(.horizontal, 14).frame(height: 48)
                            .background(QlipTheme.surfaceRaised, in: RoundedRectangle(cornerRadius: 12))
                        Button {
                            isCreating = true
                            Task {
                                revealedKey = await store.createAPIKey(name: name)
                                if revealedKey != nil { name = "" }
                                isCreating = false
                            }
                        } label: {
                            Label(isCreating ? "Generating…" : "Generate key", systemImage: "key.fill")
                                .frame(maxWidth: .infinity).frame(height: 46)
                                .foregroundStyle(QlipTheme.background)
                                .background(QlipTheme.primary, in: RoundedRectangle(cornerRadius: QlipTheme.controlRadius))
                        }
                        .buttonStyle(.plain)
                        .disabled(isCreating)
                    }
                    .padding(18)
                    .qlipCard()

                    Text("EXISTING KEYS").font(.caption.bold()).tracking(1.2).foregroundStyle(QlipTheme.foregroundMuted)
                    if store.apiKeys.isEmpty {
                        LibraryEmptyState(
                            title: "No API keys yet",
                            message: "Name a key above, then generate it to connect an MCP-compatible assistant.",
                            icon: "key.fill"
                        )
                    } else {
                        ForEach(store.apiKeys) { key in
                            HStack(spacing: 12) {
                                Image(systemName: key.isRevoked ? "key.slash" : "key.fill")
                                    .foregroundStyle(key.isRevoked ? QlipTheme.foregroundMuted : QlipTheme.primary)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(key.name).font(.subheadline.bold()).foregroundStyle(QlipTheme.foreground)
                                    Text("\(key.keyPrefix)… · \(key.isRevoked ? "Revoked" : "Active")")
                                        .font(.caption.monospaced()).foregroundStyle(QlipTheme.foregroundMuted)
                                }
                                Spacer()
                                Menu {
                                    if !key.isRevoked {
                                        Button("Revoke", systemImage: "key.slash", role: .destructive) {
                                            pendingKeyAction = PendingAPIKeyAction(key: key, kind: .revoke)
                                        }
                                    } else {
                                        Button("Delete", systemImage: "trash", role: .destructive) {
                                            pendingKeyAction = PendingAPIKeyAction(key: key, kind: .delete)
                                        }
                                    }
                                } label: { Image(systemName: "ellipsis.circle") }
                            }
                            .padding(16)
                            .qlipCard(radius: QlipTheme.controlRadius)
                            .opacity(key.isRevoked ? 0.58 : 1)
                        }
                    }

                    VStack(alignment: .leading, spacing: 5) {
                        Text("MCP ENDPOINT").font(.caption2.bold()).tracking(1)
                        Text(endpoint).font(.caption2.monospaced()).textSelection(.enabled)
                    }
                    .foregroundStyle(QlipTheme.foregroundMuted)
                }
                .padding(QlipTheme.horizontalPadding)
            }
        }
        .alert(pendingKeyAction?.kind == .revoke ? "Revoke API key?" : "Delete API key?", isPresented: Binding(
            get: { pendingKeyAction != nil },
            set: { if !$0 { pendingKeyAction = nil } }
        ), presenting: pendingKeyAction) { action in
            Button(action.kind == .revoke ? "Revoke" : "Delete", role: .destructive) {
                Task {
                    if action.kind == .revoke { await store.revokeAPIKey(action.key) }
                    else { await store.deleteAPIKey(action.key) }
                }
            }
            Button("Cancel", role: .cancel) { }
        } message: { action in
            Text(action.kind == .revoke
                 ? "Any assistant using \(action.key.name) will immediately lose access."
                 : "This permanently removes \(action.key.name) from this device's key list.")
        }
        .toolbar(.hidden, for: .tabBar)
        .navigationTitle("MCP Access")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct PendingAPIKeyAction: Identifiable {
    enum Kind: Equatable { case revoke, delete }
    let id = UUID()
    let key: QlipAPIKey
    let kind: Kind
}

private struct Metric: View {
    let value: String
    let label: String
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.system(size: 22, weight: .bold, design: .rounded)).foregroundStyle(QlipTheme.foreground)
            Text(label).font(.system(size: 9, weight: .bold)).tracking(1.2).foregroundStyle(QlipTheme.foregroundMuted)
        }
        .frame(minWidth: 62, alignment: .leading)
    }
}

private struct VaultCard: View {
    @EnvironmentObject private var store: QlipStore
    let item: ContentItem

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if item.isSocial || item.thumbnailURL != nil {
                // Keep the established 132pt media height, but let images span
                // the entire card so posts and articles read as visual content.
                SocialMediaPreview(
                    url: item.thumbnailURL,
                    sourceType: item.sourceType,
                    height: 132,
                    cornerRadius: 0
                )
            }

            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 14) {
                    sourceMark
                    VStack(alignment: .leading, spacing: 5) {
                        HStack(spacing: 6) {
                            Text((item.siteName ?? item.url.host() ?? item.sourceType).uppercased())
                                .font(.system(size: 10, weight: .bold))
                                .tracking(1)
                                .foregroundStyle(QlipTheme.foregroundMuted)
                            Spacer()
                            if item.isPinned { Image(systemName: "pin.fill").foregroundStyle(QlipTheme.primary) }
                            if item.isStarred { Image(systemName: "star.fill").foregroundStyle(QlipTheme.warning) }
                        }
                        StatusPill(status: item.status)
                        Text(item.displayTitle)
                            .font(.headline)
                            .foregroundStyle(QlipTheme.foreground)
                            .multilineTextAlignment(.leading)
                            .lineLimit(3)
                    }
                }

                Text(item.displaySummary)
                    .font(.subheadline)
                    .foregroundStyle(QlipTheme.foregroundMuted)
                    .lineSpacing(3)
                    .multilineTextAlignment(.leading)
                    .lineLimit(2)

                HStack(spacing: 6) {
                    if let folder = store.folderName(for: item) {
                        Label(folder, systemImage: item.wasAutoCategorized ? "wand.and.stars" : "folder")
                    } else if let topic = item.topic, !topic.isEmpty {
                        Label(topic, systemImage: "tag")
                    } else {
                        Text(item.contentTypeLabel ?? item.sourceType.capitalized)
                    }
                    Spacer()
                    Text(item.createdAt, format: .relative(presentation: .named))
                    Image(systemName: "chevron.right").font(.caption2.bold()).foregroundStyle(QlipTheme.primary)
                }
                .font(.caption)
                .foregroundStyle(QlipTheme.foregroundMuted)
            }
            .padding(17)
        }
        .clipShape(RoundedRectangle(cornerRadius: QlipTheme.cardRadius, style: .continuous))
        .qlipCard()
    }

    @ViewBuilder private var sourceMark: some View {
        // The full-bleed image above is the visual preview. Keep this compact
        // mark reserved for the source favicon, avoiding a duplicated thumbnail.
        if let url = item.faviconURL {
            AsyncImage(url: url) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                sourcePlaceholder
            }
            .frame(width: 54, height: 54)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        } else {
            sourcePlaceholder
        }
    }

    private var sourcePlaceholder: some View {
        RoundedRectangle(cornerRadius: 14, style: .continuous)
            .fill(QlipTheme.surfaceRaised)
            .frame(width: 54, height: 54)
            .overlay {
                Image(systemName: sourceIcon)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(QlipTheme.primary)
            }
    }

    private var sourceIcon: String {
        switch item.sourceType {
        case "youtube", "reel": "play.rectangle.fill"
        case "pdf": "doc.fill"
        case "tweet", "reddit": "bubble.left.and.text.bubble.right.fill"
        default: "bookmark.fill"
        }
    }
}

private struct StatusPill: View {
    let status: ProcessingStatus

    private var color: Color {
        switch status {
        case .ready: QlipTheme.success
        case .pending, .parsing, .enriching: QlipTheme.warning
        case .degraded, .failed: QlipTheme.destructive
        }
    }

    private var icon: String {
        switch status {
        case .ready: "checkmark"
        case .pending: "clock"
        case .parsing: "doc.text.magnifyingglass"
        case .enriching: "sparkles"
        case .degraded: "exclamationmark.triangle"
        case .failed: "xmark"
        }
    }

    var body: some View {
        Label(status.label, systemImage: icon)
            .font(.caption2.weight(.bold))
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(color.opacity(0.12), in: Capsule())
            .lineLimit(1)
    }
}

private struct LoadingVaultView: View {
    var body: some View {
        VStack(spacing: 14) {
            ProgressView().tint(QlipTheme.primary).scaleEffect(1.15)
            Text("Opening your vault…").font(.subheadline).foregroundStyle(QlipTheme.foregroundMuted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 50)
    }
}

private struct EmptyVaultView: View {
    let isSearching: Bool
    let action: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: isSearching ? "magnifyingglass" : "bookmark")
                .font(.system(size: 29, weight: .semibold))
                .foregroundStyle(QlipTheme.primary)
            Text(isSearching ? "Nothing found" : "Your vault is ready")
                .font(.system(size: 20, weight: .bold, design: .rounded))
                .foregroundStyle(QlipTheme.foreground)
            Text(isSearching ? "Try another word or clear your search." : "Save your first link and Qlip will read, summarize and organize it.")
                .font(.subheadline)
                .foregroundStyle(QlipTheme.foregroundMuted)
                .multilineTextAlignment(.center)
            Button(isSearching ? "Clear search" : "Save a link", action: action)
                .font(.subheadline.bold())
                .foregroundStyle(QlipTheme.background)
                .padding(.horizontal, 18)
                .frame(height: 44)
                .background(QlipTheme.primary, in: Capsule())
        }
        .frame(maxWidth: .infinity)
        .padding(30)
        .qlipCard()
    }
}

private struct SaveLinkView: View {
    @EnvironmentObject private var store: QlipStore
    @Environment(\.dismiss) private var dismiss
    @State private var url = ""
    @State private var destination: SaveDestination = .auto
    @State private var folderID: UUID?
    @State private var note = ""

    private var urlIssue: String? {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        guard let value = URL(string: trimmed), ["http", "https"].contains(value.scheme?.lowercased()) else {
            return "Enter a full link beginning with http:// or https://."
        }
        return nil
    }

    var body: some View {
        ZStack {
            QlipBackdrop()
            VStack(alignment: .leading, spacing: 22) {
                Capsule().fill(QlipTheme.border).frame(width: 38, height: 5).frame(maxWidth: .infinity)
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("Save a link")
                            .font(.system(size: 28, weight: .bold, design: .rounded))
                            .foregroundStyle(QlipTheme.foreground)
                        Text("Qlip routes each URL to the right place, or you can choose.")
                            .foregroundStyle(QlipTheme.foregroundMuted)
                    }
                    Spacer()
                    Button { dismiss() } label: {
                        Image(systemName: "xmark").font(.subheadline.bold()).frame(width: 40, height: 40)
                            .background(QlipTheme.surfaceRaised, in: Circle())
                    }
                }

                QlipField(label: "Link", icon: "link", prompt: "https://example.com/article") {
                    TextField("https://example.com/article", text: $url, axis: .vertical)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .textContentType(.URL)
                }
                if let urlIssue {
                    Label(urlIssue, systemImage: "exclamationmark.circle.fill")
                        .font(.footnote)
                        .foregroundStyle(QlipTheme.destructive)
                        .accessibilityLabel("Link error. \(urlIssue)")
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("SAVE IN")
                        .font(.system(size: 11, weight: .bold))
                        .tracking(1.3)
                        .foregroundStyle(QlipTheme.foregroundMuted)
                    Picker("Save in", selection: $destination) {
                        ForEach(SaveDestination.allCases) { option in
                            Text(option.title).tag(option)
                        }
                    }
                    .pickerStyle(.segmented)
                    Text(destination.detail)
                        .font(.caption)
                        .foregroundStyle(QlipTheme.foregroundMuted)
                }

                HStack(spacing: 12) {
                    Image(systemName: "folder").foregroundStyle(QlipTheme.primary)
                    Picker("Category", selection: $folderID) {
                        Text("AI chooses category").tag(UUID?.none)
                        ForEach(store.folders) { folder in
                            Text(folder.name).tag(Optional(folder.id))
                        }
                    }
                    .tint(QlipTheme.foreground)
                }
                .padding(.horizontal, 16)
                .frame(minHeight: 54)
                .background(QlipTheme.surfaceRaised.opacity(0.78), in: RoundedRectangle(cornerRadius: QlipTheme.controlRadius, style: .continuous))
                .overlay { RoundedRectangle(cornerRadius: QlipTheme.controlRadius).stroke(QlipTheme.border) }

                QlipField(label: "Note (optional)", icon: "text.bubble", prompt: "Why are you saving this?") {
                    TextField("Why are you saving this?", text: $note)
                }

                HStack(alignment: .top, spacing: 13) {
                    Image(systemName: "sparkles").foregroundStyle(QlipTheme.primary).frame(width: 24)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Capture is safe when you switch apps").font(.subheadline.bold()).foregroundStyle(QlipTheme.foreground)
                        Text("The link is queued first. Once Qlip receives it, server-side AI keeps working even when this app is closed.")
                            .font(.footnote).foregroundStyle(QlipTheme.foregroundMuted).lineSpacing(3)
                    }
                }
                .padding(16)
                .qlipCard(radius: QlipTheme.controlRadius)

                Button {
                    Task {
                        if await store.save(
                            urlText: url,
                            destination: destination,
                            folderID: folderID,
                            note: note
                        ) { dismiss() }
                    }
                } label: {
                    HStack(spacing: 9) {
                        if store.isSaving { ProgressView().tint(QlipTheme.background) }
                        Text(store.isSaving ? "Capturing…" : destination == .auto ? "Save automatically" : "Save to \(destination.title)").font(.headline)
                        if !store.isSaving { Image(systemName: "arrow.down.to.line.compact") }
                    }
                    .frame(maxWidth: .infinity).frame(height: 54)
                    .foregroundStyle(QlipTheme.background)
                    .background(QlipTheme.brandGradient, in: RoundedRectangle(cornerRadius: QlipTheme.controlRadius, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(url.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || urlIssue != nil || store.isSaving)
                .opacity(url.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || urlIssue != nil ? 0.55 : 1)
                Spacer()
            }
            .padding(.horizontal, QlipTheme.horizontalPadding)
            .padding(.top, 10)
        }
        .presentationDetents([.large])
        .presentationBackground(QlipTheme.background)
    }
}

private struct ItemEditorSheet: View {
    @EnvironmentObject private var store: QlipStore
    @Environment(\.dismiss) private var dismiss
    let item: ContentItem
    @State private var title: String
    @State private var note: String
    @State private var folderID: UUID?
    @State private var isSaving = false
    @State private var isRetrying = false

    init(item: ContentItem) {
        self.item = item
        _title = State(initialValue: item.title ?? "")
        _note = State(initialValue: item.description ?? "")
        _folderID = State(initialValue: item.folderID)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                QlipBackdrop()
                Form {
                    Section("Details") {
                        TextField("Title", text: $title, axis: .vertical)
                            .lineLimit(1...3)
                        TextField("Personal note", text: $note, axis: .vertical)
                            .lineLimit(2...6)
                    }
                    Section(item.isBookmark ? "Bookmark category" : "Category") {
                        Picker(item.isBookmark ? "Bookmark category" : "Save in", selection: $folderID) {
                            Text("AI chooses / Unfiled").tag(UUID?.none)
                            ForEach(store.folders) { folder in
                                Text(folder.name).tag(Optional(folder.id))
                            }
                        }
                        if item.isBookmark {
                            Text("Changing this only organizes the bookmark. It stays in Bookmarks.")
                                .font(.footnote)
                                .foregroundStyle(QlipTheme.foregroundMuted)
                        }
                    }
                    if item.status == .degraded || item.status == .failed {
                        Section("AI processing") {
                            Button {
                                isRetrying = true
                                Task {
                                    await store.retry(item)
                                    isRetrying = false
                                }
                            } label: {
                                Label(isRetrying ? "Retrying AI…" : "Retry AI", systemImage: "arrow.clockwise")
                            }
                            .disabled(isRetrying)
                        }
                    }
                    Section("Original link") {
                        Text(item.url.absoluteString)
                            .font(.footnote)
                            .foregroundStyle(QlipTheme.foregroundMuted)
                            .textSelection(.enabled)
                        Text("The address stays unchanged so Qlip keeps its AI history and duplicate protection.")
                            .font(.footnote)
                            .foregroundStyle(QlipTheme.foregroundMuted)
                    }
                }
                .scrollContentBackground(.hidden)
            }
            .navigationTitle("Edit link")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Save") {
                        isSaving = true
                        Task {
                            if await store.updateItem(item, title: title, description: note, folderID: folderID) {
                                dismiss()
                            }
                            isSaving = false
                        }
                    }
                    .disabled(isSaving)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationBackground(QlipTheme.background)
    }
}

/// Resolves navigation from an immutable item ID at the moment the reader
/// opens. This prevents a realtime list refresh from sending a card tap to the
/// wrong item while SwiftUI reconciles the list.
private struct ReaderDestination: View {
    @EnvironmentObject private var store: QlipStore
    let itemID: UUID

    var body: some View {
        if let item = store.items.first(where: { $0.id == itemID }) {
            ReaderView(seed: item)
        } else {
            ContentUnavailableView(
                "Link unavailable",
                systemImage: "link.badge.plus",
                description: Text("Refreshing your vault to find this link.")
            )
            .task { await store.refresh() }
        }
    }
}

private struct ReaderView: View {
    @EnvironmentObject private var store: QlipStore
    @State private var item: ContentItem
    @State private var isLoading = false
    @State private var translation: ItemTranslation?
    @State private var isTranslating = false
    @State private var showingArabic = false
    @AppStorage("reader-text-scale") private var textScale = 0
    @ScaledMetric(relativeTo: .body) private var readerBaseFontSize: CGFloat = 18

    init(seed: ContentItem) {
        _item = State(initialValue: seed)
    }

    var body: some View {
        ZStack {
            QlipBackdrop()
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    HStack(spacing: 10) {
                        StatusPill(status: item.status)
                        Text(item.siteName ?? item.url.host() ?? "")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(QlipTheme.foregroundMuted)
                    }

                    if item.isSocial || item.thumbnailURL != nil {
                        SocialMediaPreview(
                            url: item.thumbnailURL,
                            sourceType: item.sourceType,
                            height: 232,
                            cornerRadius: QlipTheme.cardRadius
                        )
                    }

                    Text(readerTitle)
                        .font(.system(.largeTitle, design: .rounded, weight: .bold))
                        .tracking(-0.5)
                        .foregroundStyle(QlipTheme.foreground)
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                        .environment(\.layoutDirection, isArabic ? .rightToLeft : .leftToRight)
                        .multilineTextAlignment(isArabic ? .trailing : .leading)

                    readerMetadata

                    readerControls

                    if let summary = readerSummary, !summary.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Label(isArabic ? "ملخص الذكاء الاصطناعي" : "AI summary", systemImage: "sparkles")
                                .font(.subheadline.bold()).foregroundStyle(QlipTheme.primary)
                            Text(summary)
                                .font(.system(size: 17)).foregroundStyle(QlipTheme.foreground).lineSpacing(6)
                                .multilineTextAlignment(isArabic ? .trailing : .leading)
                                .environment(\.layoutDirection, isArabic ? .rightToLeft : .leftToRight)
                        }
                        .padding(19)
                        .background(QlipTheme.surfaceRaised, in: RoundedRectangle(cornerRadius: QlipTheme.cardRadius, style: .continuous))
                        .overlay { RoundedRectangle(cornerRadius: QlipTheme.cardRadius).stroke(QlipTheme.primary.opacity(0.22)) }
                    }

                    if !readerKeyPoints.isEmpty {
                        VStack(alignment: .leading, spacing: 14) {
                            Text(isArabic ? "النقاط الأساسية" : "Key points").font(.system(size: 20, weight: .bold, design: .rounded)).foregroundStyle(QlipTheme.foreground)
                            ForEach(readerKeyPoints, id: \.self) { point in
                                HStack(alignment: .top, spacing: 11) {
                                    Image(systemName: "checkmark.circle.fill").foregroundStyle(QlipTheme.success).padding(.top, 2)
                                    Text(point).font(.system(size: 16)).foregroundStyle(QlipTheme.foreground).lineSpacing(4)
                                        .multilineTextAlignment(isArabic ? .trailing : .leading)
                                }
                                .environment(\.layoutDirection, isArabic ? .rightToLeft : .leftToRight)
                            }
                        }
                    }

                    if isLoading {
                        HStack { ProgressView().tint(QlipTheme.primary); Text("Loading the full article…") }
                            .font(.subheadline).foregroundStyle(QlipTheme.foregroundMuted)
                    } else if let text = readerBody, !text.isEmpty {
                        Divider().overlay(QlipTheme.border)
                        ReaderArticleText(
                            paragraphs: paragraphs(from: text),
                            fontSize: readerFontSize,
                            isArabic: isArabic
                        )
                    }

                    Link(destination: item.url) {
                        Label("Open original", systemImage: "safari")
                            .font(.headline)
                            .foregroundStyle(QlipTheme.background)
                            .frame(maxWidth: .infinity).frame(height: 52)
                            .background(QlipTheme.primary, in: RoundedRectangle(cornerRadius: QlipTheme.controlRadius, style: .continuous))
                    }
                }
                .padding(.horizontal, QlipTheme.horizontalPadding)
                .padding(.top, 16)
                .padding(.bottom, 48)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .toolbarBackground(QlipTheme.background.opacity(0.92), for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button { Task { await store.toggleStarred(item) } } label: {
                    Image(systemName: item.isStarred ? "star.fill" : "star")
                }
                .accessibilityLabel(item.isStarred ? "Remove star" : "Star item")
                Button { Task { await store.togglePinned(item) } } label: {
                    Image(systemName: item.isPinned ? "pin.fill" : "pin")
                }
                .accessibilityLabel(item.isPinned ? "Remove from Priority Vault" : "Add to Priority Vault")
                Menu {
                    Menu("Change category") {
                        Button("AI chooses / Unfiled") { Task { await store.setFolder(for: item.id, folderID: nil) } }
                        ForEach(store.folders) { folder in
                            Button(folder.name) { Task { await store.setFolder(for: item.id, folderID: folder.id) } }
                        }
                    }
                    Button("Retry AI", systemImage: "arrow.clockwise") { Task { await store.retry(item) } }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .accessibilityLabel("More article actions")
            }
        }
        .task {
            guard item.contentText == nil else { return }
            isLoading = true
            if let loaded = await store.loadDetail(for: item.id) { item = loaded }
            isLoading = false
        }
    }

    private var isArabic: Bool { showingArabic && translation != nil }
    private var readerTitle: String { isArabic ? (translation?.title?.nilIfEmpty ?? item.displayTitle) : item.displayTitle }
    private var readerSummary: String? { isArabic ? (translation?.summary?.nilIfEmpty ?? item.summary) : item.summary }
    private var readerKeyPoints: [String] { isArabic ? (translation?.keyPoints ?? item.keyPoints ?? []) : (item.keyPoints ?? []) }
    private var readerBody: String? { isArabic ? (translation?.body?.nilIfEmpty ?? item.contentText) : item.contentText }
    private var readerFontSize: CGFloat { readerBaseFontSize + CGFloat(textScale * 2) }

    @ViewBuilder private var readerMetadata: some View {
        let metadata = HStack(spacing: 12) {
            if let author = item.author?.nilIfEmpty { Label(author, systemImage: "person") }
            if let published = item.publishedAt { Label(published.formatted(date: .abbreviated, time: .omitted), systemImage: "calendar") }
            if let count = item.wordCount { Label("\(count) words", systemImage: "text.word.spacing") }
        }
        .font(.caption)
        .foregroundStyle(QlipTheme.foregroundMuted)

        ViewThatFits(in: .horizontal) {
            metadata
            VStack(alignment: .leading, spacing: 6) {
                if let author = item.author?.nilIfEmpty { Label(author, systemImage: "person") }
                HStack(spacing: 12) {
                    if let published = item.publishedAt { Label(published.formatted(date: .abbreviated, time: .omitted), systemImage: "calendar") }
                    if let count = item.wordCount { Label("\(count) words", systemImage: "text.word.spacing") }
                }
            }
            .font(.caption)
            .foregroundStyle(QlipTheme.foregroundMuted)
        }
    }

    private var readerControls: some View {
        HStack(spacing: 8) {
            Button { textScale = max(-1, textScale - 1) } label: {
                Text("A−").font(.system(size: 17, weight: .bold)).frame(width: 42, height: 42)
            }
            .buttonStyle(LinkActionButtonStyle(tint: QlipTheme.foregroundMuted))
            .disabled(textScale <= -1)
            .accessibilityLabel("Decrease reader text size")
            Button { textScale = min(2, textScale + 1) } label: {
                Text("A+").font(.system(size: 17, weight: .bold)).frame(width: 42, height: 42)
            }
            .buttonStyle(LinkActionButtonStyle(tint: QlipTheme.foregroundMuted))
            .disabled(textScale >= 2)
            .accessibilityLabel("Increase reader text size")
            Spacer(minLength: 0)
            Button {
                if translation != nil {
                    showingArabic.toggle()
                    return
                }
                isTranslating = true
                Task {
                    if let result = await store.translate(item) {
                        translation = result
                        showingArabic = true
                    }
                    isTranslating = false
                }
            } label: {
                HStack(spacing: 6) {
                    if isTranslating { ProgressView().tint(QlipTheme.primary).scaleEffect(0.75) }
                    Text(showingArabic ? "EN" : "العربية")
                }
                .fixedSize(horizontal: true, vertical: false)
            }
            .buttonStyle(LinkActionButtonStyle(tint: QlipTheme.primary))
            .disabled(isTranslating)
            .accessibilityLabel(showingArabic ? "Show original language" : "Translate to Arabic")
        }
    }

    private func paragraphs(from text: String) -> [String] {
        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n")
        let result = normalized.components(separatedBy: "\n\n")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        return result.isEmpty ? [text] : result
    }
}

private struct ReaderArticleText: View {
    let paragraphs: [String]
    let fontSize: CGFloat
    let isArabic: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: fontSize > 20 ? 24 : 19) {
            ForEach(Array(paragraphs.enumerated()), id: \.offset) { _, paragraph in
                Text(paragraph)
                    .font(.system(size: fontSize, design: isArabic ? .default : .serif))
                    .foregroundStyle(QlipTheme.foreground.opacity(0.94))
                    .lineSpacing(fontSize > 20 ? 10 : 8)
                    .multilineTextAlignment(isArabic ? .trailing : .leading)
                    .textSelection(.enabled)
            }
        }
        .frame(maxWidth: 720, alignment: isArabic ? .trailing : .leading)
        .environment(\.layoutDirection, isArabic ? .rightToLeft : .leftToRight)
    }
}

/// A deterministic media viewport keeps portrait Facebook/Reels artwork from
/// changing card height. Failed or absent remote images become a branded media
/// placeholder instead of leaving a blank area or a permanent spinner.
private struct SocialMediaPreview: View {
    let url: URL?
    let sourceType: String
    let height: CGFloat
    let cornerRadius: CGFloat

    var body: some View {
        Group {
            if let url {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    case .empty:
                        Rectangle().fill(QlipTheme.surfaceRaised)
                            .overlay { ProgressView().tint(QlipTheme.primary) }
                    case .failure:
                        fallback
                    @unknown default:
                        fallback
                    }
                }
            } else {
                fallback
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: height)
        .clipped()
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .stroke(QlipTheme.border.opacity(0.8), lineWidth: 1)
        }
    }

    private var fallback: some View {
        ZStack {
            LinearGradient(
                colors: [QlipTheme.surfaceRaised, QlipTheme.primary.opacity(0.12)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            Image(systemName: icon)
                .font(.system(size: height > 200 ? 38 : 30, weight: .semibold))
                .foregroundStyle(QlipTheme.primary)
        }
    }

    private var icon: String {
        switch sourceType {
        case "youtube", "reel": "play.rectangle.fill"
        case "tweet", "reddit": "bubble.left.and.text.bubble.right.fill"
        default: "photo.on.rectangle.angled"
        }
    }
}

#Preview { ContentView().environmentObject(QlipStore()) }
