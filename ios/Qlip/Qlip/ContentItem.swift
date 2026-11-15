import Foundation

enum SaveDestination: String, Codable, CaseIterable, Identifiable {
    case auto, bookmark, content

    var id: Self { self }
    var title: String {
        switch self {
        case .auto: "Automatic"
        case .bookmark: "Bookmarks"
        case .content: "Reading"
        }
    }

    var detail: String {
        switch self {
        case .auto: "Domains → Bookmarks · articles and posts → Reading"
        case .bookmark: "Keep this website in Bookmarks"
        case .content: "Keep this item in Reading"
        }
    }
}

struct ItemFolder: Codable, Hashable {
    let folderID: UUID
    let assignmentSource: String?

    enum CodingKeys: String, CodingKey {
        case folderID = "folder_id"
        case assignmentSource = "assignment_source"
    }
}

struct QlipFolder: Codable, Identifiable, Hashable {
    let id: UUID
    let name: String
    let color: String?
    let icon: String?
    let parentID: UUID?
    let position: Int

    enum CodingKeys: String, CodingKey {
        case id, name, color, icon, position
        case parentID = "parent_id"
    }
}

struct QlipDailyPick: Codable, Hashable {
    let itemID: UUID

    enum CodingKeys: String, CodingKey {
        case itemID = "item_id"
    }
}

struct QlipAPIKey: Codable, Identifiable, Hashable {
    let id: UUID
    let name: String
    let keyPrefix: String
    let createdAt: Date
    let lastUsedAt: Date?
    let revokedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, name
        case keyPrefix = "key_prefix"
        case createdAt = "created_at"
        case lastUsedAt = "last_used_at"
        case revokedAt = "revoked_at"
    }

    var isRevoked: Bool { revokedAt != nil }
}

enum ProcessingStatus: String, Codable {
    case pending, parsing, enriching, ready, degraded, failed

    var label: String {
        switch self {
        case .pending: "Queued"
        case .parsing: "Fetching details"
        case .enriching: "AI analysis"
        case .ready: "Ready"
        case .degraded: "AI needs retry"
        case .failed: "Could not fetch"
        }
    }
}

struct ContentItem: Codable, Identifiable, Hashable {
    let id: UUID
    let url: URL
    let title: String?
    let description: String?
    let author: String?
    let summary: String?
    let keyPoints: [String]?
    let tags: [String]
    let topic: String?
    let contentTypeLabel: String?
    let sourceType: String
    let itemKind: String?
    let savedVia: String?
    let status: ProcessingStatus
    let siteName: String?
    let thumbnailURL: URL?
    let faviconURL: URL?
    let readStatus: String
    let isStarred: Bool
    let isPinned: Bool
    let pinPosition: Int?
    let publishedAt: Date?
    let createdAt: Date
    let contentText: String?
    let wordCount: Int?
    let durationSeconds: Int?
    let itemFolders: [ItemFolder]?

    enum CodingKeys: String, CodingKey {
        case id, url, title, description, author, summary, tags, topic, status
        case keyPoints = "key_points"
        case contentTypeLabel = "content_type_label"
        case sourceType = "source_type"
        case itemKind = "item_kind"
        case savedVia = "saved_via"
        case siteName = "site_name"
        case thumbnailURL = "thumbnail_url"
        case faviconURL = "favicon_url"
        case readStatus = "read_status"
        case isStarred = "is_starred"
        case isPinned = "is_pinned"
        case pinPosition = "pin_position"
        case publishedAt = "published_at"
        case createdAt = "created_at"
        case contentText = "content_text"
        case wordCount = "word_count"
        case durationSeconds = "duration_seconds"
        case itemFolders = "item_folders"
    }

    var displayTitle: String { title?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty ?? url.host() ?? url.absoluteString }
    var displaySummary: String { summary?.nilIfEmpty ?? description?.nilIfEmpty ?? "Qlip is still learning about this link." }
    var isBookmark: Bool { itemKind == "bookmark" }
    var isMobileSave: Bool { savedVia == "mobile" || savedVia == "extension" }
    /// Phone captures have their own Library surface, while preserving the
    /// reader for videos, posts, and other enriched content.
    var appearsInReading: Bool { !isBookmark && !isMobileSave }
    var opensInReader: Bool { !isBookmark || isMobileSave }
    var isUnread: Bool { readStatus == "unread" }
    var folderID: UUID? { itemFolders?.first?.folderID }
    var wasAutoCategorized: Bool { itemFolders?.first?.assignmentSource == "ai" }
    var isSocial: Bool {
        ["reel", "tweet", "reddit"].contains(sourceType) ||
        ["instagram.com", "tiktok.com", "x.com", "twitter.com", "facebook.com", "threads.net", "linkedin.com"]
            .contains(where: { url.host()?.lowercased().contains($0) == true })
    }
}

extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

struct SaveLinkRequest: Encodable {
    let url: String
    let savedVia: String
    let destination: SaveDestination
    let folderID: UUID?
    let note: String?

    enum CodingKeys: String, CodingKey {
        case url, destination, note
        case savedVia = "saved_via"
        case folderID = "folder_id"
    }
}

struct SaveLinkResponse: Decodable {
    let id: UUID
    let status: ProcessingStatus
    let duplicate: Bool
}

struct ItemTranslation: Decodable {
    let title: String?
    let summary: String?
    let keyPoints: [String]
    let body: String?
    let lang: String
    let cached: Bool

    enum CodingKeys: String, CodingKey {
        case title, summary, body, lang, cached
        case keyPoints = "key_points"
    }
}

struct TranslateItemRequest: Encodable {
    let itemID: UUID
    let targetLanguage: String

    enum CodingKeys: String, CodingKey {
        case itemID = "item_id"
        case targetLanguage = "target_lang"
    }
}

struct FolderAssignmentInsert: Encodable {
    let itemID: UUID
    let folderID: UUID
    let userID: UUID
    let assignmentSource = "user"

    enum CodingKeys: String, CodingKey {
        case itemID = "item_id"
        case folderID = "folder_id"
        case userID = "user_id"
        case assignmentSource = "assignment_source"
    }
}

struct FolderAssignmentUpdate: Encodable {
    let folderID: UUID
    let assignmentSource = "user"

    enum CodingKeys: String, CodingKey {
        case folderID = "folder_id"
        case assignmentSource = "assignment_source"
    }
}
