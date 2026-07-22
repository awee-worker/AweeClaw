/**
 * BLE（蓝牙低功耗）协议适配器（阶段8 s8-01）
 *
 * 通过 @abandonware/noble 实现 BLE 设备扫描与 GATT 特征订阅：
 * 1. 扫描 BLE 设备（按 namePrefix / address 过滤）
 * 2. 连接目标设备
 * 3. 发现 GATT 服务与特征
 * 4. 订阅可通知（notify）特征，实时接收数据
 * 5. 轮询读取不可通知的特征（按 pollIntervalMs 间隔）
 * 6. 解析特征值为数值/字符串，回调 onReading / onEntityUpdate
 *
 * 认证方式：authConfig.deviceFilters + authConfig.serviceUuids + authConfig.characteristicUuids
 *
 * 依赖：@abandonware/noble（noble 的活跃 fork，支持 Node.js 18+）
 * - 该包需要 native 编译（node-gyp），macOS 需 Xcode CLI Tools
 * - 作为 optionalDependencies 引入，加载失败时降级为不可用状态
 * - Windows 需配合 Zadig 安装 WinUSB 驱动
 * - Linux 需 libbluetooth-dev + root/udev 权限
 *
 * @module iot/adapters/BleAdapter
 */

import { logger } from '@shared/toolkit/LogEngine';
import type {
  IoTProtocolAdapter,
  IoTProtocol,
  IoTProviderSummary,
  AdapterCallbacks,
  AdapterHandle,
  IoTEntityType,
  EntityUpdateEvent,
} from '../IoTInterface';

// ============================================================
// 常量
// ============================================================

const PROTOCOL: IoTProtocol = 'ble';

/** 扫描超时（ms） */
const SCAN_TIMEOUT_MS = 15_000;

/** 连接超时（ms） */
const CONNECT_TIMEOUT_MS = 10_000;

/** 服务发现超时（ms） */
const DISCOVERY_TIMEOUT_MS = 8_000;

/** 默认轮询间隔（ms，用于不可通知的特征） */
const DEFAULT_POLL_INTERVAL_MS = 30_000;

/** 最大设备数（防止扫描到过多设备） */
const MAX_DEVICES = 20;

/** 心跳间隔（ms，检查连接状态） */
const HEARTBEAT_INTERVAL_MS = 60_000;

// ============================================================
// 类型定义（避免直接 import noble 的类型，保持轻量）
// ============================================================

/** noble Peripheral 最小接口 */
interface NoblePeripheral {
  id: string;
  address: string;
  addressType: string;
  connectable: boolean;
  advertisement: {
    localName?: string;
    serviceUuids?: string[];
    txPowerLevel?: number;
    manufacturerData?: Buffer;
    serviceData?: Array<{ uuid: string; data: Buffer }>;
  };
  rssi: number;
  connect(callback: (error?: Error) => void): void;
  disconnect(callback?: (error?: Error) => void): void;
  discoverServices(serviceUuids: string[] | null, callback: (error: Error | null, services: NobleService[]) => void): void;
  once(event: string, listener: (...args: unknown[]) => void): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
  removeAllListeners(event?: string): void;
}

/** noble Service 最小接口 */
interface NobleService {
  uuid: string;
  name: string;
  type: string;
  discoverCharacteristics(characteristicUuids: string[] | null, callback: (error: Error | null, characteristics: NobleCharacteristic[]) => void): void;
}

/** noble Characteristic 最小接口 */
interface NobleCharacteristic {
  uuid: string;
  name: string;
  type: string;
  properties: string[];
  read(callback: (error: Error | null, data: Buffer) => void): void;
  subscribe(callback: (error?: Error) => void): void;
  unsubscribe(callback: (error?: Error) => void): void;
  on(event: string, listener: (data: Buffer, isNotification: boolean) => void): void;
  removeAllListeners(event?: string): void;
}

/** noble 模块最小接口 */
interface NobleModule {
  startScanning(serviceUuids?: string[], allowDuplicates?: boolean): void;
  stopScanning(): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
  state: string;
}

/** BLE 适配器内部状态 */
interface BleAdapterState {
  providerId: string;
  /** 设备过滤条件 */
  deviceFilters: DeviceFilter;
  /** 要发现的服务 UUID 列表 */
  serviceUuids: string[];
  /** 要订阅/读取的特征 UUID 列表 */
  characteristicUuids: string[];
  /** 轮询间隔（ms） */
  pollIntervalMs: number;
  /** noble 模块实例 */
  noble: NobleModule | null;
  /** 已连接的 peripheral */
  peripheral: NoblePeripheral | null;
  /** 已订阅的特征列表（用于清理） */
  subscribedCharacteristics: NobleCharacteristic[];
  /** 轮询定时器 */
  pollTimer: NodeJS.Timeout | null;
  /** 心跳定时器 */
  heartbeatTimer: NodeJS.Timeout | null;
  /** 是否已主动断开 */
  disconnected: boolean;
  /** 上报回调 */
  callbacks: AdapterCallbacks;
  /** 已扫描到的设备缓存（避免重复处理） */
  discoveredDevices: Map<string, NoblePeripheral>;
}

/** 设备过滤条件 */
interface DeviceFilter {
  /** 设备名称前缀（不区分大小写） */
  namePrefix?: string;
  /** 设备 MAC 地址（不区分大小写，支持冒号或横线分隔） */
  address?: string;
}

// ============================================================
// GATT 标准 service UUID → IoTEntityType 映射
// ============================================================

/** 标准 GATT 服务 UUID（16 位）前缀映射 */
const STANDARD_SERVICE_TYPE_MAP: Record<string, IoTEntityType> = {
  // 0x1809 Health Thermometer
  '1809': 'sensor',
  // 0x1810 Blood Pressure
  '1810': 'sensor',
  // 0x1811 Alert Notification
  '1811': 'binary_sensor',
  // 0x1814 Running Speed and Cadence
  '1814': 'sensor',
  // 0x1816 Cycling Speed and Cadence
  '1816': 'sensor',
  // 0x181A Environmental Sensing
  '181a': 'sensor',
  // 0x181C User Data
  '181c': 'sensor',
  // 0x181E Weight Scale
  '181e': 'sensor',
  // 0x180F Battery Service
  '180f': 'sensor',
  // 0x1808 Glucose
  '1808': 'sensor',
  // 0x1812 Human Interface Device
  '1812': 'switch',
};

// ============================================================
// BleAdapter 实现
// ============================================================

export class BleAdapter implements IoTProtocolAdapter {
  readonly protocol: IoTProtocol = PROTOCOL;

  /** 懒加载 noble 模块缓存 */
  private nobleModule: NobleModule | null = null;

  /** noble 加载失败标记（避免反复尝试） */
  private nobleLoadFailed = false;

  async connect(
    provider: IoTProviderSummary,
    callbacks: AdapterCallbacks,
  ): Promise<AdapterHandle> {
    const { deviceFilters, serviceUuids, characteristicUuids, pollIntervalMs } =
      this.parseAuthConfig(provider);

    // 懒加载 noble 模块
    let noble: NobleModule;
    try {
      noble = this.loadNobleModule();
    } catch (err) {
      throw new Error(
        `BLE 适配器不可用：${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const state: BleAdapterState = {
      providerId: provider.id,
      deviceFilters,
      serviceUuids,
      characteristicUuids,
      pollIntervalMs,
      noble,
      peripheral: null,
      subscribedCharacteristics: [],
      pollTimer: null,
      heartbeatTimer: null,
      disconnected: false,
      callbacks,
      discoveredDevices: new Map(),
    };

    // 1. 扫描设备
    const peripheral = await this.scanAndConnect(state);
    state.peripheral = peripheral;

    // 2. 发现服务与特征
    await this.discoverServicesAndSubscribe(state, peripheral);

    // 3. 启动心跳检查
    this.startHeartbeat(state);

    logger.iot?.info(
      `[BleAdapter] Provider ${provider.id} 连接成功，设备 ${peripheral.address}（${peripheral.advertisement.localName ?? '未知'}），订阅 ${state.subscribedCharacteristics.length} 个特征`,
    );

    return {
      providerId: provider.id,
      disconnect: async () => this.disconnect(state),
      isConnected: () => !state.disconnected && state.peripheral !== null,
    };
  }

  async testConnection(provider: IoTProviderSummary): Promise<{
    success: boolean;
    latencyMs?: number;
    message: string;
  }> {
    let noble: NobleModule;
    try {
      noble = this.loadNobleModule();
    } catch (err) {
      return {
        success: false,
        message: `BLE 适配器不可用：${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const { deviceFilters } = this.parseAuthConfig(provider);
    const start = Date.now();

    try {
      const peripheral = await this.scanDevice(noble, deviceFilters, SCAN_TIMEOUT_MS);
      if (!peripheral) {
        return {
          success: false,
          latencyMs: Date.now() - start,
          message: `未扫描到匹配的 BLE 设备（${this.describeFilter(deviceFilters)}）`,
        };
      }
      return {
        success: true,
        latencyMs: Date.now() - start,
        message: `发现设备 ${peripheral.advertisement.localName ?? peripheral.address}（RSSI: ${peripheral.rssi}）`,
      };
    } catch (err) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ============================================================
  // 内部方法 — 模块加载与配置解析
  // ============================================================

  /** 懒加载 @abandonware/noble 模块 */
  private loadNobleModule(): NobleModule {
    if (this.nobleModule) return this.nobleModule;
    if (this.nobleLoadFailed) {
      throw new Error('noble 模块之前加载失败，请安装 @abandonware/noble 并重新启动');
    }

    try {
      // 优先尝试 @abandonware/noble（活跃 fork）
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      this.nobleModule = require('@abandonware/noble') as NobleModule;
      logger.iot?.info('[BleAdapter] noble 模块加载成功（@abandonware/noble）');
      return this.nobleModule;
    } catch {
      // 降级尝试原版 noble
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        this.nobleModule = require('noble') as NobleModule;
        logger.iot?.info('[BleAdapter] noble 模块加载成功（noble）');
        return this.nobleModule;
      } catch (err) {
        this.nobleLoadFailed = true;
        throw new Error(
          `noble 模块未安装。请运行 npm install @abandonware/noble。错误: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /** 解析 authConfig */
  private parseAuthConfig(provider: IoTProviderSummary): {
    deviceFilters: DeviceFilter;
    serviceUuids: string[];
    characteristicUuids: string[];
    pollIntervalMs: number;
  } {
    const auth = provider.authConfig || {};

    // 设备过滤条件
    const deviceFilters: DeviceFilter = {};
    const namePrefix = auth.namePrefix as string | undefined;
    const address = auth.address as string | undefined;
    if (typeof namePrefix === 'string' && namePrefix.trim()) {
      deviceFilters.namePrefix = namePrefix.trim();
    }
    if (typeof address === 'string' && address.trim()) {
      deviceFilters.address = address.trim().toLowerCase();
    }

    // 服务 UUID 列表
    let serviceUuids: string[] = [];
    const rawServices = auth.serviceUuids;
    if (Array.isArray(rawServices)) {
      serviceUuids = rawServices
        .filter((u): u is string => typeof u === 'string' && u.length > 0)
        .map((u) => u.toLowerCase());
    }

    // 特征 UUID 列表
    let characteristicUuids: string[] = [];
    const rawChars = auth.characteristicUuids;
    if (Array.isArray(rawChars)) {
      characteristicUuids = rawChars
        .filter((u): u is string => typeof u === 'string' && u.length > 0)
        .map((u) => u.toLowerCase());
    }

    // 轮询间隔
    const rawPoll = auth.pollIntervalMs as number | undefined;
    const pollIntervalMs =
      typeof rawPoll === 'number' && rawPoll > 0
        ? Math.min(rawPoll, 300_000) // 上限 5 分钟
        : DEFAULT_POLL_INTERVAL_MS;

    return { deviceFilters, serviceUuids, characteristicUuids, pollIntervalMs };
  }

  // ============================================================
  // 内部方法 — 扫描与连接
  // ============================================================

  /** 扫描并连接设备 */
  private async scanAndConnect(state: BleAdapterState): Promise<NoblePeripheral> {
    const peripheral = await this.scanDevice(
      state.noble!,
      state.deviceFilters,
      SCAN_TIMEOUT_MS,
    );
    if (!peripheral) {
      throw new Error(
        `BLE 扫描未发现匹配设备（${this.describeFilter(state.deviceFilters)}）`,
      );
    }

    // 连接设备
    await this.connectPeripheral(peripheral);
    logger.iot?.info(
      `[BleAdapter] Provider ${state.providerId} 已连接设备 ${peripheral.address}`,
    );

    return peripheral;
  }

  /** 扫描 BLE 设备 */
  private scanDevice(
    noble: NobleModule,
    filters: DeviceFilter,
    timeoutMs: number,
  ): Promise<NoblePeripheral | null> {
    return new Promise((resolve) => {
      const discovered = new Map<string, NoblePeripheral>();
      let settled = false;

      // noble 的 'discover' 事件回调签名为 (...args: unknown[]) => void
      // 实际第一个参数为 NoblePeripheral，需在内部断言
      const onDiscover = (...args: unknown[]): void => {
        if (settled) return;
        const peripheral = args[0] as NoblePeripheral;

        // 去重
        if (discovered.has(peripheral.id)) return;
        discovered.set(peripheral.id, peripheral);

        // 防止扫描到过多设备（达到上限停止扫描）
        if (discovered.size >= MAX_DEVICES) {
          settled = true;
          noble.stopScanning();
          noble.removeListener('discover', onDiscover);
          logger.iot?.warn(
            `[BleAdapter] 扫描到 ${discovered.size} 个设备达到上限，停止扫描`,
          );
        }

        // 应用过滤条件
        if (!this.matchDevice(peripheral, filters)) return;

        // 命中：停止扫描并返回
        settled = true;
        noble.stopScanning();
        noble.removeListener('discover', onDiscover);
        resolve(peripheral);
      };

      noble.on('discover', onDiscover);

      // 启动扫描
      try {
        noble.startScanning([], false);
      } catch {
        settled = true;
        noble.removeListener('discover', onDiscover);
        resolve(null);
        return;
      }

      // 超时处理
      setTimeout(() => {
        if (settled) return;
        settled = true;
        noble.stopScanning();
        noble.removeListener('discover', onDiscover);

        // 扫描超时但发现了设备（未匹配过滤条件）→ 返回 null
        if (discovered.size > 0) {
          logger.iot?.warn(
            `[BleAdapter] 扫描到 ${discovered.size} 个设备但无匹配（过滤: ${this.describeFilter(filters)}）`,
          );
        }
        resolve(null);
      }, timeoutMs);
    });
  }

  /** 判断设备是否匹配过滤条件 */
  private matchDevice(peripheral: NoblePeripheral, filters: DeviceFilter): boolean {
    // 名称前缀匹配
    if (filters.namePrefix) {
      const localName = peripheral.advertisement.localName ?? '';
      if (!localName.toLowerCase().startsWith(filters.namePrefix.toLowerCase())) {
        return false;
      }
    }

    // 地址匹配
    if (filters.address) {
      const peripheralAddr = peripheral.address.toLowerCase();
      const normalizedFilter = filters.address.replace(/[-:]/g, '');
      const normalizedPeripheral = peripheralAddr.replace(/[-:]/g, '');
      if (normalizedPeripheral !== normalizedFilter) {
        return false;
      }
    }

    return true;
  }

  /** 连接设备 */
  private connectPeripheral(peripheral: NoblePeripheral): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`BLE 连接超时（${CONNECT_TIMEOUT_MS}ms）`));
      }, CONNECT_TIMEOUT_MS);

      peripheral.connect((error?: Error) => {
        clearTimeout(timeout);
        if (error) {
          reject(new Error(`BLE 连接失败: ${error.message}`));
          return;
        }
        resolve();
      });
    });
  }

  // ============================================================
  // 内部方法 — 服务发现与特征订阅
  // ============================================================

  /** 发现服务与特征，订阅可通知特征 */
  private async discoverServicesAndSubscribe(
    state: BleAdapterState,
    peripheral: NoblePeripheral,
  ): Promise<void> {
    const services = await this.discoverServices(peripheral, state.serviceUuids);

    const pollableCharacteristics: NobleCharacteristic[] = [];

    for (const service of services) {
      const characteristics = await this.discoverCharacteristics(service, state.characteristicUuids);

      for (const char of characteristics) {
        const canNotify = char.properties.includes('notify') || char.properties.includes('indicate');
        const canRead = char.properties.includes('read');

        if (canNotify) {
          // 订阅通知
          await this.subscribeCharacteristic(state, service, char);
        } else if (canRead) {
          // 不可通知但可读 → 加入轮询列表
          pollableCharacteristics.push(char);
        }
      }
    }

    // 启动轮询（对于不可通知的可读特征）
    if (pollableCharacteristics.length > 0) {
      this.startPolling(state, pollableCharacteristics);
    }
  }

  /** 发现服务 */
  private discoverServices(
    peripheral: NoblePeripheral,
    serviceUuids: string[],
  ): Promise<NobleService[]> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`BLE 服务发现超时（${DISCOVERY_TIMEOUT_MS}ms）`));
      }, DISCOVERY_TIMEOUT_MS);

      peripheral.discoverServices(
        serviceUuids.length > 0 ? serviceUuids : null,
        (error, services) => {
          clearTimeout(timeout);
          if (error) {
            reject(new Error(`BLE 服务发现失败: ${error.message}`));
            return;
          }
          resolve(services);
        },
      );
    });
  }

  /** 发现特征 */
  private discoverCharacteristics(
    service: NobleService,
    characteristicUuids: string[],
  ): Promise<NobleCharacteristic[]> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`BLE 特征发现超时（${DISCOVERY_TIMEOUT_MS}ms）`));
      }, DISCOVERY_TIMEOUT_MS);

      service.discoverCharacteristics(
        characteristicUuids.length > 0 ? characteristicUuids : null,
        (error, characteristics) => {
          clearTimeout(timeout);
          if (error) {
            reject(new Error(`BLE 特征发现失败: ${error.message}`));
            return;
          }
          resolve(characteristics);
        },
      );
    });
  }

  /** 订阅特征通知 */
  private subscribeCharacteristic(
    state: BleAdapterState,
    service: NobleService,
    char: NobleCharacteristic,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('BLE 特征订阅超时'));
      }, 5_000);

      const onData = (data: Buffer, isNotification: boolean): void => {
        if (state.disconnected) return;
        if (!isNotification) return;
        this.handleCharacteristicData(state, service, char, data);
      };

      char.on('data', onData);

      char.subscribe((error?: Error) => {
        clearTimeout(timeout);
        if (error) {
          char.removeAllListeners('data');
          reject(new Error(`BLE 特征订阅失败: ${error.message}`));
          return;
        }
        state.subscribedCharacteristics.push(char);
        logger.iot?.debug(
          `[BleAdapter] Provider ${state.providerId} 已订阅特征 ${char.uuid}（服务 ${service.uuid}）`,
        );
        resolve();
      });
    });
  }

  // ============================================================
  // 内部方法 — 数据处理
  // ============================================================

  /** 处理特征数据 */
  private handleCharacteristicData(
    state: BleAdapterState,
    service: NobleService,
    char: NobleCharacteristic,
    data: Buffer,
  ): void {
    const externalId = `${state.peripheral?.address ?? 'unknown'}/${service.uuid}/${char.uuid}`;
    const entityType = this.inferEntityType(service.uuid);
    const { value, stringValue, unit } = this.parseCharacteristicData(char, data);

    // 数值型数据触发 reading
    if (value !== null) {
      state.callbacks.onReading({
        entityId: '',
        externalId,
        value,
        unit,
        timestamp: Date.now(),
      });
    }

    // 所有数据触发 entityUpdate
    const event: EntityUpdateEvent = {
      providerId: state.providerId,
      entityId: '',
      externalId,
      entityType,
      state: value ?? stringValue ?? data.toString('hex'),
      attributes: {
        serviceUuid: service.uuid,
        characteristicUuid: char.uuid,
        rssi: state.peripheral?.rssi,
        rawData: data.toString('hex'),
      },
      timestamp: Date.now(),
    };
    state.callbacks.onEntityUpdate(event);
  }

  /** 推断实体类型（基于 GATT 服务 UUID） */
  private inferEntityType(serviceUuid: string): IoTEntityType {
    // 标准 16 位 UUID（如 0x1809）
    const shortUuid = serviceUuid.replace(/^0000|0000$/g, '').toLowerCase();
    if (STANDARD_SERVICE_TYPE_MAP[shortUuid]) {
      return STANDARD_SERVICE_TYPE_MAP[shortUuid];
    }

    // 自定义 UUID 默认为 sensor
    return 'sensor';
  }

  /** 解析特征数据 */
  private parseCharacteristicData(
    char: NobleCharacteristic,
    data: Buffer,
  ): { value: number | null; stringValue: string | null; unit?: string } {
    // 1. 尝试解析为数值（小端序，BLE 标准为小端）
    if (data.length === 1) {
      return { value: data.readUInt8(0), stringValue: null };
    }
    if (data.length === 2) {
      return { value: data.readInt16LE(0) / 100, stringValue: null, unit: this.inferUnit(char.uuid) };
    }
    if (data.length === 4) {
      return { value: data.readFloatLE(0), stringValue: null, unit: this.inferUnit(char.uuid) };
    }

    // 2. 尝试解析为 UTF-8 字符串
    const str = data.toString('utf-8').trim();
    if (str && /^[\x20-\x7E]+$/.test(str)) {
      // 字符串中可能包含数值
      const num = Number(str);
      if (Number.isFinite(num)) {
        return { value: num, stringValue: str };
      }
      return { value: null, stringValue: str };
    }

    // 3. 尝试解析为 JSON
    try {
      const json = JSON.parse(str);
      if (typeof json === 'number') {
        return { value: json, stringValue: null };
      }
      if (json && typeof json === 'object' && typeof json.value === 'number') {
        return { value: json.value, stringValue: str, unit: json.unit };
      }
    } catch {
      // 非 JSON，忽略
    }

    return { value: null, stringValue: data.toString('hex') };
  }

  /** 从特征 UUID 推断单位 */
  private inferUnit(charUuid: string): string | undefined {
    const short = charUuid.replace(/^0000|0000$/g, '').toLowerCase();
    // 0x2A6E Temperature
    if (short === '2a6e') return '°C';
    // 0x2A6F Humidity
    if (short === '2a6f') return '%';
    // 0x2A77 Pressure
    if (short === '2a77') return 'hPa';
    // 0x2A19 Battery Level
    if (short === '2a19') return '%';
    return undefined;
  }

  // ============================================================
  // 内部方法 — 轮询与心跳
  // ============================================================

  /** 启动轮询（对于不可通知的可读特征） */
  private startPolling(
    state: BleAdapterState,
    characteristics: NobleCharacteristic[],
  ): void {
    if (characteristics.length === 0) return;

    const poll = async (): Promise<void> => {
      if (state.disconnected || !state.peripheral) return;

      for (const char of characteristics) {
        try {
          const data = await this.readCharacteristic(char);
          // 需要找到对应的服务（简化处理：用 char.uuid 构造 externalId）
          const fakeService = { uuid: 'poll', name: '', type: '' } as NobleService;
          this.handleCharacteristicData(state, fakeService, char, data);
        } catch (err) {
          logger.iot?.warn(
            `[BleAdapter] Provider ${state.providerId} 轮询读取特征 ${char.uuid} 失败:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    };

    // 立即执行一次
    void poll();
    state.pollTimer = setInterval(() => void poll(), state.pollIntervalMs);
    logger.iot?.info(
      `[BleAdapter] Provider ${state.providerId} 启动轮询，${characteristics.length} 个特征，间隔 ${state.pollIntervalMs}ms`,
    );
  }

  /** 读取特征值 */
  private readCharacteristic(char: NobleCharacteristic): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('BLE 特征读取超时'));
      }, 5_000);

      char.read((error: Error | null, data: Buffer) => {
        clearTimeout(timeout);
        if (error) {
          reject(new Error(`BLE 特征读取失败: ${error.message}`));
          return;
        }
        resolve(data);
      });
    });
  }

  /** 启动心跳检查 */
  private startHeartbeat(state: BleAdapterState): void {
    const peripheral = state.peripheral;
    if (!peripheral) {
      logger.iot?.warn(
        `[BleAdapter] Provider ${state.providerId} 启动心跳时 peripheral 为空，跳过`,
      );
      return;
    }

    state.heartbeatTimer = setInterval(() => {
      if (state.disconnected) return;
      if (!state.peripheral) {
        state.callbacks.onDisconnect('BLE 设备已断开（peripheral 为空）');
        return;
      }
      // noble 没有直接的 isConnected 方法，通过 rssi 更新判定
      // 如果 peripheral 触发了 disconnect 事件，onDisconnect 回调会处理
    }, HEARTBEAT_INTERVAL_MS);

    // 监听 peripheral 断开事件
    const onDisconnect = (): void => {
      if (state.disconnected) return;
      logger.iot?.warn(
        `[BleAdapter] Provider ${state.providerId} 设备 ${peripheral.address ?? 'unknown'} 意外断开`,
      );
      state.callbacks.onDisconnect('BLE 设备连接丢失');
    };

    peripheral.once('disconnect', onDisconnect as (...args: unknown[]) => void);
  }

  // ============================================================
  // 内部方法 — 断开与清理
  // ============================================================

  /** 断开连接 */
  private async disconnect(state: BleAdapterState): Promise<void> {
    if (state.disconnected) return;
    state.disconnected = true;

    // 清理定时器
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
    if (state.heartbeatTimer) {
      clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }

    // 取消订阅所有特征
    for (const char of state.subscribedCharacteristics) {
      try {
        char.removeAllListeners('data');
        await new Promise<void>((resolve) => {
          char.unsubscribe((error?: Error) => {
            if (error) {
              logger.iot?.warn(
                `[BleAdapter] Provider ${state.providerId} 取消订阅特征 ${char.uuid} 失败:`,
                error.message,
              );
            }
            resolve();
          });
        });
      } catch (err) {
        logger.iot?.warn(
          `[BleAdapter] Provider ${state.providerId} 清理特征 ${char.uuid} 异常:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    state.subscribedCharacteristics = [];

    // 断开 peripheral
    if (state.peripheral) {
      try {
        await new Promise<void>((resolve) => {
          state.peripheral!.disconnect((error?: Error) => {
            if (error) {
              logger.iot?.warn(
                `[BleAdapter] Provider ${state.providerId} 断开设备异常:`,
                error.message,
              );
            }
            resolve();
          });
        });
      } catch (err) {
        logger.iot?.warn(
          `[BleAdapter] Provider ${state.providerId} 断开设备异常:`,
          err instanceof Error ? err.message : String(err),
        );
      }
      state.peripheral.removeAllListeners();
      state.peripheral = null;
    }

    // 停止扫描（如果仍在扫描）
    if (state.noble) {
      try {
        state.noble.stopScanning();
      } catch {
        // ignore
      }
    }

    logger.iot?.info(`[BleAdapter] Provider ${state.providerId} 已断开`);
  }

  /** 描述过滤条件（用于日志） */
  private describeFilter(filters: DeviceFilter): string {
    const parts: string[] = [];
    if (filters.namePrefix) parts.push(`namePrefix=${filters.namePrefix}`);
    if (filters.address) parts.push(`address=${filters.address}`);
    return parts.length > 0 ? parts.join(', ') : '无过滤条件';
  }
}

// 默认导出单例
export const bleAdapter = new BleAdapter();
