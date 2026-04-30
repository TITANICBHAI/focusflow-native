package com.tbtechs.nodespy.data

import android.content.Context
import android.content.SharedPreferences
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken

object PrefsStore {

    private const val PREFS_NAME = "nodespy_data"
    private const val KEY_ALLOWLIST = "allowlist"
    private const val KEY_AUTO_PIN_RULES = "auto_pin_rules"
    private const val KEY_EXPORT_HISTORY = "export_history"
    private const val KEY_APP_MODE = "app_mode"
    private const val KEY_BUBBLE_INTRO_SHOWN = "bubble_intro_shown"

    private val gson = Gson()
    private lateinit var prefs: SharedPreferences

    fun init(context: Context) {
        prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    fun loadAllowlist(): Set<String> =
        prefs.getStringSet(KEY_ALLOWLIST, emptySet()) ?: emptySet()

    fun saveAllowlist(set: Set<String>) {
        prefs.edit().putStringSet(KEY_ALLOWLIST, set).apply()
    }

    fun loadAutoPinRules(): List<AutoPinRule> {
        val json = prefs.getString(KEY_AUTO_PIN_RULES, null) ?: return emptyList()
        return try {
            val type = object : TypeToken<List<AutoPinRule>>() {}.type
            gson.fromJson(json, type)
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun saveAutoPinRules(rules: List<AutoPinRule>) {
        prefs.edit().putString(KEY_AUTO_PIN_RULES, gson.toJson(rules)).apply()
    }

    fun loadExportHistory(): List<ExportRecord> {
        val json = prefs.getString(KEY_EXPORT_HISTORY, null) ?: return emptyList()
        return try {
            val type = object : TypeToken<List<ExportRecord>>() {}.type
            gson.fromJson(json, type)
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun saveExportHistory(history: List<ExportRecord>) {
        prefs.edit().putString(KEY_EXPORT_HISTORY, gson.toJson(history)).apply()
    }

    fun loadAppMode(): AppMode {
        val name = prefs.getString(KEY_APP_MODE, AppMode.SIMPLE.name) ?: AppMode.SIMPLE.name
        return try { AppMode.valueOf(name) } catch (_: Exception) { AppMode.SIMPLE }
    }

    fun saveAppMode(mode: AppMode) {
        prefs.edit().putString(KEY_APP_MODE, mode.name).apply()
    }

    fun isBubbleIntroShown(): Boolean = prefs.getBoolean(KEY_BUBBLE_INTRO_SHOWN, false)

    fun markBubbleIntroShown() {
        prefs.edit().putBoolean(KEY_BUBBLE_INTRO_SHOWN, true).apply()
    }
}
