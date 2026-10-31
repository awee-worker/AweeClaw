/**
 * 交给 AI 时的浮层收尾
 *
 * 左侧菜单打开的内置面板（待办、AI 浏览器、项目、知识库、邮件中心）与场景工具
 * 都是带遮罩的右侧抽屉，浮在聊天区之上。这类面板里的「交给 AI」一点，会话立刻
 * 开始执行，内容落在聊天区——抽屉若还盖着，执行过程被遮住，输入框也点不到，
 * 用户只能再手动关一次，看上去像按钮没生效。
 *
 * 因此凡是「把活交给 AI」的动作，收尾统一走这里：把用户带回聊天区，顺带清掉
 * 沿途打开的所有浮层。各关闭函数在未打开时都是空操作，重复调用无副作用。
 */
import { useStore } from '../state'
import { closePanelDrawer } from '../plugins/pluginDrawerStore'
import { closeSceneToolDrawer } from '../components/scene-tools/sceneToolDrawerStore'

/**
 * 回到聊天区并收起所有浮层。
 *
 * 顺序无关紧要：各层互不依赖，谁开着就关谁。
 */
export function closeOverlaysForChat(): void {
  const store = useStore.getState()
  store.closeAllFullPages()
  store.closeSidePanelForView()
  store.setChatVisible(true)
  closePanelDrawer()
  closeSceneToolDrawer()
}
