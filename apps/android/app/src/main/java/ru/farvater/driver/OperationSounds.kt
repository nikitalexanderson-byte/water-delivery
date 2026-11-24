package ru.farvater.driver

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.SoundPool
import org.json.JSONObject

internal enum class OperationCue(val resource: Int) {
    Acknowledged(R.raw.operation_ack),
    Completed(R.raw.operation_done),
    Attention(R.raw.operation_attention),
}

internal fun operationCue(path: String, response: JSONObject): OperationCue =
    when (path.substringAfterLast('/')) {
        "settle" -> if (response.optBoolean("matched")) OperationCue.Completed else OperationCue.Attention
        "deliver", "sale", "return" -> OperationCue.Completed
        "fail" -> OperationCue.Attention
        else -> OperationCue.Acknowledged
    }

internal class OperationSounds(context: Context) {
    private val audio = context.getSystemService(AudioManager::class.java)
    private val loaded = mutableSetOf<Int>()
    private val pool = SoundPool.Builder()
        .setMaxStreams(1)
        .setAudioAttributes(AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build())
        .build()
    private val samples: Map<OperationCue, Int>

    init {
        pool.setOnLoadCompleteListener { _, sample, status ->
            if (status == 0) loaded.add(sample)
        }
        samples = OperationCue.entries.associateWith { pool.load(context, it.resource, 1) }
    }

    fun play(cue: OperationCue) {
        if (audio?.ringerMode != AudioManager.RINGER_MODE_NORMAL) return
        val sample = samples.getValue(cue)
        if (sample in loaded) pool.play(sample, 0.75f, 0.75f, 1, 0, 1f)
    }

    fun close() {
        pool.setOnLoadCompleteListener(null)
        pool.release()
    }
}
