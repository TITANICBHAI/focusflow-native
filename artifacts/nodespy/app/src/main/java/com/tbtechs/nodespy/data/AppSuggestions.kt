package com.tbtechs.nodespy.data

@Suppress("unused")
data class BlockSuggestion(
    val label: String,
    val description: String,
    val keywords: List<String>
)

data class AppProfile(
    val displayName: String,
    val tagline: String,
    val suggestions: List<BlockSuggestion>
)

val KNOWN_APP_PROFILES: Map<String, AppProfile> = mapOf(

    "com.google.android.youtube" to AppProfile(
        displayName = "YouTube",
        tagline = "Common things people block on YouTube",
        suggestions = listOf(
            BlockSuggestion("Shorts", "Short vertical videos in the bottom navigation", listOf("shorts", "reel", "shorts_pivot")),
            BlockSuggestion("Home recommendations", "Algorithmically suggested videos on the home feed", listOf("home_feed", "recommend", "watch_next")),
            BlockSuggestion("Autoplay next video", "The countdown that plays the next video automatically", listOf("autoplay", "next_up", "endscreen")),
            BlockSuggestion("Comments section", "The comments below videos", listOf("comment", "comments_panel")),
            BlockSuggestion("Notification bell", "Channel notification button", listOf("notification_bell", "subscribe_button"))
        )
    ),

    "com.instagram.android" to AppProfile(
        displayName = "Instagram",
        tagline = "Common things people block on Instagram",
        suggestions = listOf(
            BlockSuggestion("Reels tab", "Short video discovery tab in the bottom navigation", listOf("reels", "clips_tab", "video_tab")),
            BlockSuggestion("Explore tab", "The search and discovery tab", listOf("explore", "search_tab", "discover")),
            BlockSuggestion("Suggested posts", "Posts recommended by the algorithm", listOf("suggest", "recommend", "for_you")),
            BlockSuggestion("Stories bar", "Stories from accounts you follow at the top", listOf("stories", "tray", "story_ring")),
            BlockSuggestion("Shopping tab", "Instagram shop/marketplace tab", listOf("shop", "commerce", "shopping"))
        )
    ),

    "com.zhiliaoapp.musically" to AppProfile(
        displayName = "TikTok",
        tagline = "Common things people block on TikTok",
        suggestions = listOf(
            BlockSuggestion("For You page", "The main algorithmic video feed", listOf("foryou", "for_you", "fyp", "recommend")),
            BlockSuggestion("Following feed", "Videos from accounts you follow", listOf("following", "follow_tab")),
            BlockSuggestion("Live section", "Live streams and LIVE button", listOf("live", "livestream")),
            BlockSuggestion("LIVE button", "The button to go live", listOf("live_btn", "go_live")),
            BlockSuggestion("Discover/Explore", "Trending sounds and hashtags", listOf("discover", "explore", "trending"))
        )
    ),

    "com.facebook.katana" to AppProfile(
        displayName = "Facebook",
        tagline = "Common things people block on Facebook",
        suggestions = listOf(
            BlockSuggestion("Reels", "Short video content in the feed", listOf("reels", "video_home", "clips")),
            BlockSuggestion("Video tab", "Facebook Watch / video section", listOf("watch", "video_tab", "fb_shorts")),
            BlockSuggestion("Suggested groups", "Group recommendations", listOf("suggest", "group_suggest", "groups_you")),
            BlockSuggestion("Marketplace", "Buy and sell section", listOf("marketplace", "commerce")),
            BlockSuggestion("Gaming", "Facebook gaming tab", listOf("gaming", "game_tab", "instantgames"))
        )
    ),

    "com.twitter.android" to AppProfile(
        displayName = "X (Twitter)",
        tagline = "Common things people block on X / Twitter",
        suggestions = listOf(
            BlockSuggestion("For You tab", "Algorithmic tweet recommendations", listOf("for_you", "home_tab", "algorithmic")),
            BlockSuggestion("Trending topics", "What's trending section", listOf("trending", "explore_tab", "whats_happening")),
            BlockSuggestion("Who to follow", "Account recommendations", listOf("who_to_follow", "user_recommend")),
            BlockSuggestion("Spaces", "Live audio rooms", listOf("spaces", "audio_space")),
            BlockSuggestion("Ads / Promoted", "Promoted tweets in the feed", listOf("promoted", "ad_", "sponsored"))
        )
    ),

    "com.reddit.frontpage" to AppProfile(
        displayName = "Reddit",
        tagline = "Common things people block on Reddit",
        suggestions = listOf(
            BlockSuggestion("Popular feed", "Trending posts from all of Reddit", listOf("popular", "trending", "all_feed")),
            BlockSuggestion("Recommended communities", "Subreddit suggestions in the feed", listOf("recommend", "community_suggest", "join_community")),
            BlockSuggestion("Video tab", "Short-form video content", listOf("video_tab", "shorts", "watch")),
            BlockSuggestion("Promoted posts", "Ads in the feed", listOf("promoted", "ad_", "sponsored"))
        )
    ),

    "com.snapchat.android" to AppProfile(
        displayName = "Snapchat",
        tagline = "Common things people block on Snapchat",
        suggestions = listOf(
            BlockSuggestion("Spotlight", "Short video discovery feed", listOf("spotlight", "discover_tab")),
            BlockSuggestion("Discover stories", "Suggested stories from brands and creators", listOf("discover", "story_suggest", "publisher")),
            BlockSuggestion("Games", "Snap games section", listOf("game", "minis", "snap_games")),
            BlockSuggestion("Map explore", "Snap Map recommended content", listOf("snap_map", "map_explore"))
        )
    ),

    "com.linkedin.android" to AppProfile(
        displayName = "LinkedIn",
        tagline = "Common things people block on LinkedIn",
        suggestions = listOf(
            BlockSuggestion("People you may know", "Connection suggestions in the feed", listOf("pymk", "people_may_know", "connection_suggest")),
            BlockSuggestion("News section", "LinkedIn News sidebar articles", listOf("news", "linkedin_news", "trending_article")),
            BlockSuggestion("Premium upsells", "LinkedIn Premium promotion banners", listOf("premium", "upsell", "upgrade")),
            BlockSuggestion("Suggested posts", "Algorithm-picked posts outside your network", listOf("suggest", "recommend", "for_you"))
        )
    )
)

fun getAppProfile(pkg: String): AppProfile? = KNOWN_APP_PROFILES[pkg]

fun matchesSuggestion(suggestion: BlockSuggestion, node: NodeEntry): Boolean {
    val searchText = listOfNotNull(node.resId, node.text, node.desc, node.hint, node.cls)
        .joinToString(" ")
        .lowercase()
    return suggestion.keywords.any { keyword -> searchText.contains(keyword.lowercase()) }
}
