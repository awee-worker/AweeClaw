/**
 * Java 环境管理 API
 *
 * 覆盖 IPC 频道：
 * - java:getStatus     — Java 运行时状态
 * - java:getPath       — java 可执行文件路径
 * - java:getJavacPath  — javac 可执行文件路径
 * - java:getHome       — JDK 根目录
 * - java:ensureReady   — 检测并按需安装
 * - java:redetect      — 重新探测本机 Java（不安装）
 * - java:reinstall     — 重新安装
 * - java:setCustomPath — 指定 java 路径
 */
import { invoke } from '../ipcHelpers'

export function createJavaApi() {
  return {
    javaGetStatus: invoke('java:getStatus'),
    javaRedetect: invoke('java:redetect'),
    javaGetPath: invoke('java:getPath'),
    javaGetJavacPath: invoke('java:getJavacPath'),
    javaGetHome: invoke('java:getHome'),
    javaEnsureReady: invoke('java:ensureReady'),
    javaReinstall: invoke('java:reinstall'),
    javaSetCustomPath: (customPath: string | null) => invoke('java:setCustomPath')(customPath),
  }
}
