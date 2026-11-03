/**
 * 模型级生成参数约束
 *
 * 部分模型把采样参数锁定在固定取值，传入其它值会被网关直接拒绝（HTTP 400），
 * 整轮对话因此不可用。这类约束需要同时作用于内置对话、OpenAI 兼容接口等
 * 所有调用链，所以集中放在 shared 层，主进程与渲染进程共用同一套判定。
 *
 * 具体判定规则位于 `modelCapabilityProfile`：本文件只保留对外入口，避免
 * 同一件事在多个文件里各写一份正则。
 */

import { resolveModelCapabilityProfile } from './modelCapabilityProfile'

/**
 * 温度被模型锁死的判断。
 *
 * Moonshot Kimi K2 系列（kimi-k2-0711-preview、kimi-k2-turbo-preview、
 * kimi-k2-thinking、kimi-k2.5、kimi-k2.7-code 等）为推理模型，
 * 网关只接受 temperature=1，其余取值返回
 * "invalid temperature: only 1 is allowed for this model"。
 */
export function isFixedTemperatureModel(model: string | undefined): boolean {
  return resolveModelCapabilityProfile(model).fixedTemperature !== undefined
}

/**
 * 返回模型强制的温度值；该模型未强制时返回 undefined。
 */
export function resolveFixedTemperature(model: string | undefined): number | undefined {
  return resolveModelCapabilityProfile(model).fixedTemperature
}

