package com.tbtechs.nodespy

import android.app.Application
import com.tbtechs.nodespy.data.CaptureStore
import com.tbtechs.nodespy.data.PrefsStore

class NodeSpyApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        PrefsStore.init(this)
        CaptureStore.loadPersistedState()
    }
}
