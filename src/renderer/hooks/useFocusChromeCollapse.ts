/**
 * 专注布局自动收放
 *
 * 打开文件编辑器或内置浏览器后，主区域被工作内容占满，左侧外壳继续占位只会挤压
 * 可视区域。这里在进入「专注布局」时收起外壳，并把收起前的状态记进布局切片；
 * 关闭编辑器 / 浏览器后按快照恢复。
 *
 * 收起的范围按占用宽度区分：
 * - 文件编辑器：只收起菜单栏，工作空间侧边栏保留（用户仍要在侧栏挑文件）
 * - 内置浏览器：菜单栏与侧边栏一起收起（页面要占满整块横向空间）
 *
 * 判定口径与主内容区保持一致，不额外推断：
 * - 内置浏览器：地址非空且当前不在「AI 浏览器」面板内（那是在面板里内嵌浏览）
 * - 预览标签页：激活的 Tab 是 open_preview 打开的页面（kind='preview'），
 *   它虽然占据编辑器位置，但本质是内置浏览器，同样按浏览器专注处理
 * - 编辑器：存在打开的文件且有激活文件（文件预览 / 预览标签页同样走这条路）
 *
 * 用户在专注期间主动展开了菜单栏或打开了侧栏面板，布局切片会丢弃快照，退出时
 * 不再覆盖其选择。
 */
import { useLayoutEffect } from 'react'
import { useStore } from '@store'
import type { SidebarItemDescriptor } from '@shared/protocols/scenario'

export function useFocusChromeCollapse(sidebarItems?: SidebarItemDescriptor[]): void {
  // 旧配置缺这个字段时按「开启」处理，与默认值保持一致
  const enabled = useStore((s) => s.editorConfig.autoCollapseChromeOnFocus !== false)
  const internalBrowserUrl = useStore((s) => s.internalBrowserUrl)
  const activeSidePanel = useStore((s) => s.activeSidePanel)
  // 只订阅布尔量：openFiles 数组会随编辑内容逐键重建，订阅数组会让这层白跑
  const hasOpenFiles = useStore((s) => s.openFiles.length > 0)
  const activeFilePath = useStore((s) => s.activeFilePath)

  // 声明了 hideEditor 的面板要求隐藏编辑器（主区域让给面板本身），
  // 此时有打开的文件并不代表进入了专注布局，不能顺手把面板收起来。
  const editorHiddenByPanel = Boolean(
    activeSidePanel && sidebarItems?.find((item) => item.id === activeSidePanel)?.hideEditor,
  )

  // 预览标签页（open_preview 打开的页面）也以 kind='preview' 的文件形式占据一个 Tab，
  // 看着像编辑器，实际是内置浏览器：同样要让出整块横向空间。
  const activeFileKind = useStore((s) =>
    s.activeFilePath
      ? s.openFiles.find((file) => file.path === s.activeFilePath)?.kind ?? null
      : null,
  )

  const isBrowserFocus =
    ((Boolean(internalBrowserUrl) && activeSidePanel !== 'ai-browser') ||
      activeFileKind === 'preview') &&
    !editorHiddenByPanel
  const isEditorFocus = hasOpenFiles && activeFilePath !== null && !editorHiddenByPanel
  const isFocusLayout = isBrowserFocus || isEditorFocus

  // 用 useLayoutEffect：收放必须在浏览器绘制前完成。
  // 否则「编辑器已按侧边栏占位的宽度渲染一次 → 收起侧边栏 → 再变宽」会连着跳两下。
  //
  // isBrowserFocus 也进依赖：浏览器关闭后回到编辑器（专注布局整体仍是 true）时，
  // 需要把浏览器收起的侧边栏放回去，否则要等到编辑器一起关掉才恢复。
  useLayoutEffect(() => {
    const store = useStore.getState()
    if (enabled && isFocusLayout) {
      store.enterFocusLayout({ collapseSidePanel: isBrowserFocus })
    } else {
      store.exitFocusLayout()
    }
  }, [enabled, isFocusLayout, isBrowserFocus])
}
