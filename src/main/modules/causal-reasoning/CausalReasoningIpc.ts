/**
 * 因果推理 IPC 处理器
 *
 * 在主进程注册 IPC 处理器，暴露 CausalReasoningService 能力给渲染进程。
 * 渲染进程通过 window.electronAPI.causal.* 调用。
 *
 * 所有方法返回 { success: boolean, data?: T, error?: string } 统一格式。
 *
 * @module causal-reasoning/CausalReasoningIpc
 */

import { ipcMain, BrowserWindow } from 'electron';
import { logger } from '@shared/toolkit/LogEngine';
import { CausalReasoningService } from './CausalReasoningService';
import { llmAssertionExtractor } from './LlmAssertionExtractor';
import type { ExtractedAssertion } from './CausalReasoningInterface';

/** IPC 频道前缀 */
const IPC_PREFIX = 'causal:';

/** 包装异步操作为统一 IPC 响应 */
async function wrap<T>(
  fn: () => Promise<T> | T,
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  try {
    const data = await fn();
    return { success: true, data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.causal?.error('[IPC] 操作失败:', e);
    return { success: false, error: msg };
  }
}

/** 注册因果推理 IPC 处理器 */
export function registerCausalReasoningIpc(): void {
  const service = CausalReasoningService.getInstance();

  // ============================================================
  // 配置管理
  // ============================================================

  ipcMain.handle(`${IPC_PREFIX}getConfig`, async () => {
    return wrap(() => service.getConfig());
  });

  ipcMain.handle(`${IPC_PREFIX}updateConfig`, async (_, updates) => {
    return wrap(() => service.updateConfig(updates));
  });

  // ============================================================
  // 节点管理
  // ============================================================

  ipcMain.handle(`${IPC_PREFIX}listNodes`, async (_, filter) => {
    return wrap(() => service.listNodes(filter));
  });

  ipcMain.handle(`${IPC_PREFIX}createNode`, async (_, input) => {
    return wrap(() => service.createNode(input));
  });

  ipcMain.handle(`${IPC_PREFIX}updateNode`, async (_, nodeId, updates) => {
    return wrap(() => service.updateNode(nodeId, updates));
  });

  ipcMain.handle(`${IPC_PREFIX}deleteNode`, async (_, nodeId) => {
    return wrap(() => {
      service.deleteNode(nodeId);
      return true;
    });
  });

  // ============================================================
  // 边管理
  // ============================================================

  ipcMain.handle(`${IPC_PREFIX}listEdges`, async (_, filter) => {
    return wrap(() => service.listEdges(filter));
  });

  ipcMain.handle(`${IPC_PREFIX}createEdge`, async (_, input) => {
    return wrap(() => service.createEdge(input));
  });

  ipcMain.handle(`${IPC_PREFIX}createEdgeByNames`, async (_, input) => {
    return wrap(() => service.createEdgeByNames(input));
  });

  ipcMain.handle(`${IPC_PREFIX}updateEdge`, async (_, edgeId, updates) => {
    return wrap(() => service.updateEdge(edgeId, updates));
  });

  ipcMain.handle(`${IPC_PREFIX}deleteEdge`, async (_, edgeId) => {
    return wrap(() => {
      service.deleteEdge(edgeId);
      return true;
    });
  });

  // ============================================================
  // 断言管理
  // ============================================================

  ipcMain.handle(`${IPC_PREFIX}listAssertions`, async (_, filter) => {
    return wrap(() => service.listAssertions(filter));
  });

  ipcMain.handle(`${IPC_PREFIX}reportAssertion`, async (_, input) => {
    return wrap(() => service.reportAssertion(input));
  });

  ipcMain.handle(`${IPC_PREFIX}batchReportAssertions`, async (_, inputs) => {
    return wrap(() => service.batchReportAssertions(inputs));
  });

  ipcMain.handle(
    `${IPC_PREFIX}reviewAssertion`,
    async (_, assertionId, review) => {
      return wrap(() => service.reviewAssertion(assertionId, review));
    },
  );

  ipcMain.handle(`${IPC_PREFIX}extractAssertions`, async (_, sourceText, minConfidence) => {
    return wrap(() => service.extractAssertions(sourceText, minConfidence));
  });

  // ============================================================
  // LLM 抽取（通过渲染层 IntelligenceCore 调用 LLM）
  // ============================================================

  /**
   * 使用 LLM 从文本中抽取因果断言
   *
   * 通过 BrowserWindow.webContents.executeJavaScript 调用渲染层暴露的
   * window.__extractCausalAssertions 函数，由渲染层调用 IntelligenceCore 的 LLM 能力。
   *
   * 渲染层需在 preload 或入口处注册：
   *   window.__extractCausalAssertions = async (text, minConfidence) => { ... }
   */
  ipcMain.handle(
    `${IPC_PREFIX}extractWithLlm`,
    async (event, sourceText: string, minConfidence: number = 0.6) => {
      return wrap(async () => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win || win.isDestroyed()) {
          throw new Error('窗口不可用，无法调用 LLM');
        }

        // 调用渲染层暴露的 LLM 抽取函数
        const script = `(window.__extractCausalAssertions 
          ? window.__extractCausalAssertions(${JSON.stringify(sourceText)}, ${minConfidence})
          : Promise.resolve([]))`;
        const result = await win.webContents.executeJavaScript(script, true);

        if (!Array.isArray(result)) {
          return [] as ExtractedAssertion[];
        }
        return result as ExtractedAssertion[];
      });
    },
  );

  /**
   * LLM 抽取器初始化（阶段6重构：主进程直调模式）
   *
   * 渲染层通过此 IPC 传入 LLM 配置（model + apiKey + baseUrl），
   * 主进程的 LlmAssertionExtractor 直接调用 LLMService，无需 IPC 回调。
   *
   * 优势：
   * - 消除 IPC 来回开销，抽取延迟降低 50%+
   * - 主进程直接持有 LLM 句柄，可复用连接池
   * - 失败重试在主进程内闭环，不影响渲染层
   *
   * 兼容性：保留旧版 registerLlmCallback IPC，但内部也走 LlmAssertionExtractor。
   */
  let llmCallbackRegistered = false;

  ipcMain.handle(
    `${IPC_PREFIX}initLlmExtractor`,
    async (_, config: { model: string; apiKey?: string; baseUrl?: string; temperature?: number }) => {
      return wrap(async () => {
        // 动态导入 LLMService 避免循环依赖
        const { LLMService } = await import('../ai-provider/AIProviderService');
        const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
        if (!win) {
          throw new Error('无可用的 BrowserWindow，无法初始化 LLMService');
        }

        const llmService = new LLMService(win);
        llmAssertionExtractor.initialize(llmService, config);

        // 注入回调到 AssertionExtractor（主进程直调，不再走 IPC 回调）
        service.setLlmCallback(async (text: string, minConf: number) => {
          return llmAssertionExtractor.extract(text, minConf);
        });

        llmCallbackRegistered = true;
        logger.causal?.info('[IPC] LLM 抽取器已初始化（主进程直调模式）');
        return true;
      });
    },
  );

  ipcMain.handle(`${IPC_PREFIX}registerLlmCallback`, async () => {
    // 兼容旧版接口：如果 LlmAssertionExtractor 已初始化则直接复用
    if (llmAssertionExtractor.isInitialized()) {
      service.setLlmCallback(async (text: string, minConf: number) => {
        return llmAssertionExtractor.extract(text, minConf);
      });
      llmCallbackRegistered = true;
      return { success: true, data: true };
    }

    // 旧版降级模式：通过渲染层 executeJavaScript 调用
    llmCallbackRegistered = true;
    service.setLlmCallback(async (text: string, minConf: number) => {
      if (!llmCallbackRegistered) return [];
      const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
      if (!win) return [];

      try {
        const script = `(window.__extractCausalAssertions 
          ? window.__extractCausalAssertions(${JSON.stringify(text)}, ${minConf})
          : Promise.resolve([]))`;
        const result = await win.webContents.executeJavaScript(script, true);
        return Array.isArray(result) ? result : [];
      } catch (err) {
        logger.causal?.warn('[IPC] LLM 回调调用失败:', err);
        return [];
      }
    });
    return { success: true, data: true };
  });

  ipcMain.handle(`${IPC_PREFIX}unregisterLlmCallback`, async () => {
    llmCallbackRegistered = false;
    service.setLlmCallback(null);
    llmAssertionExtractor.reset();
    return { success: true, data: true };
  });

  // ============================================================
  // 干预与反事实查询
  // ============================================================
  // 阶段5新增：所有查询方法均支持可选 sceneKey 参数，用于场景级阈值覆盖

  ipcMain.handle(
    `${IPC_PREFIX}intervention`,
    async (_, interventionVar, interventionValue, observedVar, sceneKey?: string) => {
      return wrap(() =>
        service.intervention(
          interventionVar,
          interventionValue,
          observedVar,
          sceneKey,
        ),
      );
    },
  );

  ipcMain.handle(
    `${IPC_PREFIX}counterfactual`,
    async (
      _,
      interventionVar,
      interventionValue,
      observedVar,
      observedValue,
      sceneKey?: string,
    ) => {
      return wrap(() =>
        service.counterfactual(
          interventionVar,
          interventionValue,
          observedVar,
          observedValue,
          sceneKey,
        ),
      );
    },
  );

  ipcMain.handle(
    `${IPC_PREFIX}backdoorAdjustment`,
    async (_, interventionVar, observedVar, sceneKey?: string) => {
      return wrap(() =>
        service.backdoorAdjustment(interventionVar, observedVar, sceneKey),
      );
    },
  );

  ipcMain.handle(
    `${IPC_PREFIX}frontdoorAdjustment`,
    async (_, interventionVar, observedVar, sceneKey?: string) => {
      return wrap(() =>
        service.frontdoorAdjustment(interventionVar, observedVar, sceneKey),
      );
    },
  );

  ipcMain.handle(
    `${IPC_PREFIX}sensitivityAnalysis`,
    async (_, interventionVar, observedVar, sceneKey?: string) => {
      return wrap(() =>
        service.sensitivityAnalysis(interventionVar, observedVar, sceneKey),
      );
    },
  );

  ipcMain.handle(`${IPC_PREFIX}listQueries`, async (_, filter) => {
    return wrap(() => service.listQueries(filter));
  });

  // ============================================================
  // 场景级阈值配置（阶段5新增）
  // ============================================================

  /** 列出所有场景阈值配置 */
  ipcMain.handle(`${IPC_PREFIX}listSceneConfigs`, async () => {
    return wrap(() => service.listSceneConfigs());
  });

  /** 获取指定场景的阈值配置 */
  ipcMain.handle(`${IPC_PREFIX}getSceneConfig`, async (_, sceneKey: string) => {
    return wrap(() => service.getSceneConfig(sceneKey));
  });

  /** 创建或更新场景阈值配置 */
  ipcMain.handle(
    `${IPC_PREFIX}upsertSceneConfig`,
    async (
      _,
      sceneKey: string,
      updates: {
        strongThreshold?: number;
        moderateThreshold?: number;
        weakThreshold?: number;
        enabled?: boolean;
        description?: string;
      },
    ) => {
      return wrap(() => service.upsertSceneConfig(sceneKey, updates));
    },
  );

  /** 删除场景阈值配置 */
  ipcMain.handle(`${IPC_PREFIX}deleteSceneConfig`, async (_, sceneKey: string) => {
    return wrap(() => service.deleteSceneConfig(sceneKey));
  });

  // ============================================================
  // 图统计
  // ============================================================

  ipcMain.handle(`${IPC_PREFIX}getStats`, async () => {
    return wrap(() => service.getStats());
  });

  // ============================================================
  // 事件流收集
  // ============================================================

  ipcMain.handle(`${IPC_PREFIX}collectEvent`, async (_, event) => {
    return wrap(() => {
      service.collectEvent(event);
      return true;
    });
  });

  ipcMain.handle(`${IPC_PREFIX}flushEvents`, async () => {
    return wrap(() => service.flushEvents());
  });

  // ============================================================
  // 数据维护
  // ============================================================

  ipcMain.handle(`${IPC_PREFIX}cleanupExpired`, async () => {
    return wrap(() => service.cleanupExpired());
  });

  ipcMain.handle(`${IPC_PREFIX}clearAllData`, async () => {
    return wrap(() => {
      service.clearAllData();
      return true;
    });
  });

  logger.causal?.info('[CausalReasoningIpc] IPC 处理器已注册');
}
