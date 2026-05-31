import { logger } from '@toolkit/LogEngine'
import { useStore } from '@store'

const E2EE_DB_NAME = 'aweeclaw_e2ee_keys'
const E2EE_DB_VERSION = 1
const E2EE_KEY_STORE = 'key_store'
const E2EE_KEY_ID = 'master_key_pair'

const AES_KEY_LENGTH = 256
const AES_IV_LENGTH = 12
const RSA_MODULUS_LENGTH = 2048
const RSA_PUBLIC_EXPONENT = new Uint8Array([1, 0, 1])

interface E2EEKeyPair {
  publicKeyJwk: JsonWebKey
  privateKeyJwk: JsonWebKey
  createdAt: number
  deviceId: string
}

export interface EncryptedPayload {
  encryptedData: string
  iv: string
  encryptedKey: string
  version: number
}

class E2EEncryptionService {
  private db: IDBDatabase | null = null
  private initPromise: Promise<IDBDatabase> | null = null
  private cachedKeyPair: { publicKey: CryptoKey; privateKey: CryptoKey } | null = null

  private async getDB(): Promise<IDBDatabase> {
    if (this.db) return this.db
    if (this.initPromise) return this.initPromise

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(E2EE_DB_NAME, E2EE_DB_VERSION)

      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(E2EE_KEY_STORE)) {
          db.createObjectStore(E2EE_KEY_STORE)
        }
      }

      request.onsuccess = () => {
        this.db = request.result
        resolve(this.db)
      }

      request.onerror = () => {
        this.initPromise = null
        reject(request.error)
      }
    })

    return this.initPromise
  }

  async isInitialized(): Promise<boolean> {
    try {
      const keyPair = await this.loadKeyPair()
      return keyPair !== null
    } catch {
      return false
    }
  }

  async initialize(): Promise<{ publicKeyJwk: JsonWebKey }> {
    const existing = await this.loadKeyPair()
    if (existing) {
      const publicKey = await crypto.subtle.importKey(
        'jwk',
        existing.publicKeyJwk,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        true,
        ['encrypt'],
      )
      const privateKey = await crypto.subtle.importKey(
        'jwk',
        existing.privateKeyJwk,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        true,
        ['decrypt'],
      )
      this.cachedKeyPair = { publicKey, privateKey }
      return { publicKeyJwk: existing.publicKeyJwk }
    }

    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: RSA_MODULUS_LENGTH,
        publicExponent: RSA_PUBLIC_EXPONENT,
        hash: 'SHA-256',
      },
      true,
      ['encrypt', 'decrypt'],
    )

    const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey)
    const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey)

    const stored: E2EEKeyPair = {
      publicKeyJwk,
      privateKeyJwk,
      createdAt: Date.now(),
      deviceId: crypto.randomUUID(),
    }

    await this.saveKeyPair(stored)
    this.cachedKeyPair = { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey }

    const privacy = useStore.getState().privacySettings
    useStore.getState().set('privacySettings', {
      ...privacy,
      e2eePublicKey: JSON.stringify(publicKeyJwk),
    })

    logger.agent.info('[E2EE] Key pair generated and stored')
    return { publicKeyJwk }
  }

  async encrypt(data: string, recipientPublicKeyJwk?: JsonWebKey): Promise<EncryptedPayload> {
    if (!this.cachedKeyPair) {
      await this.initialize()
    }

    const aesKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: AES_KEY_LENGTH },
      true,
      ['encrypt', 'decrypt'],
    )

    const iv = crypto.getRandomValues(new Uint8Array(AES_IV_LENGTH))
    const encodedData = new TextEncoder().encode(data)

    const encryptedData = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      encodedData,
    )

    const publicKey = recipientPublicKeyJwk
      ? await crypto.subtle.importKey(
          'jwk',
          recipientPublicKeyJwk,
          { name: 'RSA-OAEP', hash: 'SHA-256' },
          true,
          ['encrypt'],
        )
      : this.cachedKeyPair!.publicKey

    const exportedAesKey = await crypto.subtle.exportKey('raw', aesKey) as ArrayBuffer
    const encryptedKey = await crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      publicKey,
      new Uint8Array(exportedAesKey),
    )

    return {
      encryptedData: this.arrayBufferToBase64(encryptedData),
      iv: this.arrayBufferToBase64(iv),
      encryptedKey: this.arrayBufferToBase64(encryptedKey),
      version: 1,
    }
  }

  async decrypt(payload: EncryptedPayload): Promise<string> {
    if (!this.cachedKeyPair) {
      await this.initialize()
    }

    const encryptedKey = this.base64ToArrayBuffer(payload.encryptedKey)
    const aesKeyRaw = await crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      this.cachedKeyPair!.privateKey,
      encryptedKey,
    )

    const aesKey = await crypto.subtle.importKey(
      'raw',
      aesKeyRaw,
      { name: 'AES-GCM', length: AES_KEY_LENGTH },
      false,
      ['decrypt'],
    )

    const iv = this.base64ToArrayBuffer(payload.iv)
    const encryptedData = this.base64ToArrayBuffer(payload.encryptedData)

    const decryptedData = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv) },
      aesKey,
      encryptedData,
    )

    return new TextDecoder().decode(decryptedData)
  }

  async encryptBatch(items: string[]): Promise<EncryptedPayload[]> {
    return Promise.all(items.map(item => this.encrypt(item)))
  }

  async decryptBatch(payloads: EncryptedPayload[]): Promise<string[]> {
    return Promise.all(payloads.map(payload => this.decrypt(payload)))
  }

  async exportPublicKey(): Promise<JsonWebKey | null> {
    if (!this.cachedKeyPair) {
      const existing = await this.loadKeyPair()
      if (!existing) return null
    }
    if (!this.cachedKeyPair) return null

    return crypto.subtle.exportKey('jwk', this.cachedKeyPair.publicKey)
  }

  async destroyKeys(): Promise<void> {
    this.cachedKeyPair = null

    const db = await this.getDB()
    const tx = db.transaction(E2EE_KEY_STORE, 'readwrite')
    tx.objectStore(E2EE_KEY_STORE).delete(E2EE_KEY_ID)

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })

    const privacy = useStore.getState().privacySettings
    useStore.getState().set('privacySettings', {
      ...privacy,
      e2eePublicKey: '',
      e2eeEncryptedPrivateKey: '',
      enableE2EE: false,
      knowledgeSyncMode: privacy.knowledgeSyncMode === 'sync-with-encryption' ? 'local-only' : privacy.knowledgeSyncMode,
    })

    logger.agent.info('[E2EE] Keys destroyed')
  }

  private async loadKeyPair(): Promise<E2EEKeyPair | null> {
    try {
      const db = await this.getDB()
      return new Promise((resolve, reject) => {
        const tx = db.transaction(E2EE_KEY_STORE, 'readonly')
        const store = tx.objectStore(E2EE_KEY_STORE)
        const request = store.get(E2EE_KEY_ID)

        request.onsuccess = () => resolve(request.result ?? null)
        request.onerror = () => reject(request.error)
      })
    } catch {
      return null
    }
  }

  private async saveKeyPair(keyPair: E2EEKeyPair): Promise<void> {
    const db = await this.getDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(E2EE_KEY_STORE, 'readwrite')
      const store = tx.objectStore(E2EE_KEY_STORE)
      const request = store.put(keyPair, E2EE_KEY_ID)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  private arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64)
    const buffer = new ArrayBuffer(binary.length)
    const view = new Uint8Array(buffer)
    for (let i = 0; i < binary.length; i++) {
      view[i] = binary.charCodeAt(i)
    }
    return buffer
  }
}

export const e2eEncryption = new E2EEncryptionService()
