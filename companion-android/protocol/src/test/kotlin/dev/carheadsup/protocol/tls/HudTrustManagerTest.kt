package dev.carheadsup.protocol.tls

import dev.carheadsup.protocol.auth.CertFingerprint
import dev.carheadsup.protocol.auth.SHARED_CERTIFICATE_VECTORS
import dev.carheadsup.protocol.auth.TrustProblem
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.ByteArrayInputStream
import java.net.InetAddress
import java.security.KeyFactory
import java.security.KeyStore
import java.security.PrivateKey
import java.security.cert.CertificateException
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.security.spec.PKCS8EncodedKeySpec
import java.util.Base64
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLServerSocket
import javax.net.ssl.SSLSocket
import kotlin.concurrent.thread

/**
 * The phone's trust manager against real TLS handshakes with certificates made by the HUD's
 * generator (test resources `tls/hud.pem` and `tls/relay.pem`: key and certificate, as the HUD
 * keeps them in its data directory).
 */
class HudTrustManagerTest {
    private class Identity(val key: PrivateKey, val certificate: X509Certificate) {
        val fingerprint: String = CertFingerprint.of(certificate.encoded)
    }

    private fun identity(resource: String): Identity {
        val pem = javaClass.getResource("/tls/$resource")!!.readText()
        fun block(label: String): ByteArray = Base64.getMimeDecoder().decode(
            pem.substringAfter("-----BEGIN $label-----").substringBefore("-----END $label-----"),
        )
        val key = KeyFactory.getInstance("EC").generatePrivate(PKCS8EncodedKeySpec(block("PRIVATE KEY")))
        val certificate =
            CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(block("CERTIFICATE")))
                as X509Certificate
        return Identity(key, certificate)
    }

    private val hud = identity("hud.pem")
    private val relay = identity("relay.pem")
    private val servers = mutableListOf<SSLServerSocket>()

    @AfterEach
    fun closeServers() {
        servers.forEach { it.close() }
    }

    /** A TLS server with [identity] that answers each connection with one line. */
    private fun serve(identity: Identity): Int {
        val password = "test".toCharArray()
        val store = KeyStore.getInstance("PKCS12").apply {
            load(null, null)
            setKeyEntry("hud", identity.key, password, arrayOf(identity.certificate))
        }
        val keys = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).apply {
            init(store, password)
        }
        val context = SSLContext.getInstance("TLS").apply { init(keys.keyManagers, null, null) }
        val server = context.serverSocketFactory.createServerSocket(
            0,
            8,
            InetAddress.getLoopbackAddress(),
        ) as SSLServerSocket
        servers += server
        thread(isDaemon = true) {
            while (!server.isClosed) {
                try {
                    (server.accept() as SSLSocket).use { socket ->
                        socket.outputStream.write("hello over TLS\n".toByteArray())
                        socket.outputStream.flush()
                    }
                } catch (e: Exception) {
                    // A refused handshake, or the server closing.
                }
            }
        }
        return server.localPort
    }

    /** Connect as the phone does, trusting through [trust]; the open socket, or the failure. */
    private fun connect(port: Int, trust: HudTrustManager): Result<SSLSocket> = runCatching {
        val socket = trust.socketFactory.createSocket(InetAddress.getLoopbackAddress(), port) as SSLSocket
        socket.soTimeout = 5_000
        socket.startHandshake()
        socket
    }

    @Test
    fun `trusts any certificate on first use, and records it for the proofs`() {
        val port = serve(hud)
        val trust = HudTrustManager(pinnedFingerprint = null)
        val socket = connect(port, trust).getOrThrow()
        socket.use {
            assertEquals("hello over TLS", it.inputStream.bufferedReader().readLine())
            assertEquals(hud.fingerprint, trust.presentedFingerprint)
            assertEquals(hud.fingerprint, trust.acceptedFingerprint)
            assertNull(trust.rejection)
            // The name check is the pin check: the HUD is reached by IP, not by a certified name.
            assertTrue(trust.hostnameVerifier.verify("127.0.0.1", it.session))
            assertTrue(trust.hostnameVerifier.verify("any.name", it.session))
        }
        assertEquals(SHARED_CERTIFICATE_VECTORS[0].fingerprint, hud.fingerprint)
    }

    @Test
    fun `accepts exactly the pinned certificate`() {
        val pinned = HudTrustManager(pinnedFingerprint = hud.fingerprint)
        connect(serve(hud), pinned).getOrThrow().use {
            assertTrue(pinned.hostnameVerifier.verify("10.42.0.1", it.session))
        }

        val changed = HudTrustManager(pinnedFingerprint = hud.fingerprint)
        val failure = connect(serve(relay), changed).exceptionOrNull()
        assertInstanceOf(SSLHandshakeException::class.java, failure)
        assertEquals(
            TrustProblem.CertificateChanged(pinned = hud.fingerprint, presented = relay.fingerprint),
            changed.rejection,
        )
        assertEquals(relay.fingerprint, changed.presentedFingerprint)
        assertNull(changed.acceptedFingerprint)
        // The reason travels in the exception too.
        val cause = generateSequence(failure) { it.cause }.filterIsInstance<HudCertificateException>().firstOrNull()
        assertEquals(changed.rejection, cause?.problem)
    }

    @Test
    fun `refuses on first pairing a certificate other than the advertised one`() {
        val trust = HudTrustManager(pinnedFingerprint = null, advertisedFingerprint = hud.fingerprint)
        assertInstanceOf(SSLHandshakeException::class.java, connect(serve(relay), trust).exceptionOrNull())
        assertEquals(
            TrustProblem.CertificateMismatch(advertised = hud.fingerprint, presented = relay.fingerprint),
            trust.rejection,
        )
        val advertised = HudTrustManager(pinnedFingerprint = null, advertisedFingerprint = hud.fingerprint)
        connect(serve(hud), advertised).getOrThrow().close()
        assertEquals(hud.fingerprint, advertised.acceptedFingerprint)
    }

    @Test
    fun `the hostname verifier refuses a session with another certificate than the one accepted`() {
        val first = HudTrustManager(pinnedFingerprint = null)
        connect(serve(hud), first).getOrThrow().use { socket ->
            // A trust manager pinned to another certificate does not accept this session…
            assertFalse(HudTrustManager(pinnedFingerprint = relay.fingerprint).verify(socket.session))
            // …nor does one that never accepted a certificate (no handshake of its own).
            assertFalse(HudTrustManager(pinnedFingerprint = null).verify(socket.session))
            assertTrue(first.verify(socket.session))
        }
        assertFalse(first.verify(null))
    }

    @Test
    fun `decides on the leaf certificate only and trusts no authority`() {
        val trust = HudTrustManager(pinnedFingerprint = hud.fingerprint)
        assertEquals(
            CertificateDecision.Trusted(hud.fingerprint, pinned = true),
            trust.decide(arrayOf(hud.certificate, relay.certificate)),
        )
        assertEquals(
            CertificateDecision.Rejected(TrustProblem.CertificateChanged(hud.fingerprint, relay.fingerprint)),
            trust.decide(arrayOf(relay.certificate, hud.certificate)),
        )
        assertInstanceOf(CertificateDecision.Rejected::class.java, trust.decide(arrayOf()))
        assertInstanceOf(CertificateDecision.Rejected::class.java, trust.decide(null))
        assertEquals(0, trust.acceptedIssuers.size)
        assertThrows(CertificateException::class.java) {
            trust.checkClientTrusted(arrayOf(hud.certificate), "ECDHE_ECDSA")
        }
        assertThrows(CertificateException::class.java) { trust.checkServerTrusted(arrayOf(), "ECDHE_ECDSA") }
        trust.checkServerTrusted(arrayOf(hud.certificate), "ECDHE_ECDSA")
        assertEquals(hud.fingerprint, trust.acceptedFingerprint)
    }
}
