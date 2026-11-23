package ru.farvater.driver

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.io.IOException
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

internal class ApiError(val status: Int, message: String) : IOException(message)

internal class DriverApi {
    suspend fun saveReport(date: String, token: String, destination: () -> OutputStream) = withContext(Dispatchers.IO) {
        val day = java.time.LocalDate.parse(date)
        val connection = URL("${BuildConfig.API_URL}/api/reports.csv?date=$day").openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 8000
            connection.readTimeout = 20000
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.setRequestProperty("Accept", "text/csv")
            if (connection.responseCode != 200)
                throw ApiError(connection.responseCode, "Не удалось получить отчёт.")
            if (!connection.contentType.orEmpty().substringBefore(';').equals("text/csv", true))
                throw IOException("Неожиданный формат отчёта")
            connection.inputStream.use { source -> destination().use { output -> source.copyTo(output) } }
        } finally {
            connection.disconnect()
        }
    }
    suspend fun call(
        path: String, token: String = "", body: JSONObject? = null, key: String? = null,
        readTimeoutMs: Int = 12_000,
    ): JSONObject = withContext(Dispatchers.IO) {
        val connection = URL("${BuildConfig.API_URL}/api/$path").openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 8000
            connection.readTimeout = readTimeoutMs
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Accept", "application/json")
            if (token.isNotEmpty()) connection.setRequestProperty("Authorization", "Bearer $token")
            key?.let { connection.setRequestProperty("Idempotency-Key", it) }
            body?.let {
                connection.requestMethod = "POST"
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { out -> out.write(it.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            if (status !in 200..299) {
                val raw = connection.errorStream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
                throw ApiError(status, runCatching { JSONObject(raw).getString("error") }
                    .getOrDefault("Ошибка сервера ($status)"))
            }
            val raw = connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            if (raw.isBlank()) JSONObject() else JSONObject(raw)
        } finally {
            connection.disconnect()
        }
    }
}

// Android Keystore protects the session, the last route and the write awaiting acknowledgement.
internal class SecureStore(context: Context) {
    private val prefs = context.getSharedPreferences("driver.private.v1", Context.MODE_PRIVATE)
    private val vault = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private val alias = "ru.farvater.driver.local.v1"
    private val key: SecretKey by lazy {
        (vault.getKey(alias, null) as? SecretKey) ?: KeyGenerator
            .getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
                init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
                generateKey()
            }
    }
    fun put(name: String, value: JSONObject?) {
        val editor = prefs.edit()
        if (value == null) editor.remove(name) else {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key)
            cipher.updateAAD(name.toByteArray())
            val bytes = cipher.doFinal(value.toString().toByteArray(Charsets.UTF_8))
            editor.putString(name, Base64.encodeToString(cipher.iv + bytes, Base64.NO_WRAP))
        }
        if (!editor.commit()) throw IOException("Не удалось сохранить данные на устройстве")
    }
    fun get(name: String): JSONObject? {
        val encoded = prefs.getString(name, null) ?: return null
        val bytes = Base64.decode(encoded, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        cipher.updateAAD(name.toByteArray())
        return JSONObject(cipher.doFinal(bytes.copyOfRange(12, bytes.size)).toString(Charsets.UTF_8))
    }
}
