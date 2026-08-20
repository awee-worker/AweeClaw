/**
 * 场景开发助手组件注册
 *
 * 将所有 UI 组件注册到场景组件注册表。
 */
import type React from 'react'
import type { ScenarioComponentRegistry } from '@shared/protocols/scenario-arch'
import ProjectListPanel from './project/ProjectListPanel'
import ProjectWorkspacePanel from './project/ProjectWorkspacePanel'
import ProjectCreateDialog from './project/ProjectCreateDialog'
import BuildPanel from './build/BuildPanel'
import InstallPanel from './install/InstallPanel'
import PublishPanel from './publish/PublishPanel'
import KnowledgePanel from './knowledge/KnowledgePanel'
import DocsBrowserPanel from './docs/DocsBrowserPanel'
import TemplateListPanel from './template/TemplateListPanel'
import ScenarioConfigEditor from './editor/ScenarioConfigEditor'
import PromptEditor from './editor/PromptEditor'
import ScriptEditor from './editor/ScriptEditor'
import DbScriptEditor from './editor/DbScriptEditor'
import ToolDefinitionEditor from './editor/ToolDefinitionEditor'
import ValidationResultPanel from './editor/ValidationResultPanel'
import PreviewPanel from './preview/PreviewPanel'
import BuilderSettingsPanel from './settings/BuilderSettingsPanel'
import BuilderStatusBar from './status/BuilderStatusBar'
import BuilderStatusIndicator from './status/BuilderStatusIndicator'
import BuilderWelcomePage from './welcome/BuilderWelcomePage'
import DebugPanel from './debug/DebugPanel'

export const scenarioBuilderComponents: ScenarioComponentRegistry = {
  ProjectListPanel: ProjectListPanel as React.ComponentType<unknown>,
  ProjectWorkspacePanel: ProjectWorkspacePanel as React.ComponentType<unknown>,
  ProjectCreateDialog: ProjectCreateDialog as React.ComponentType<unknown>,
  BuildPanel: BuildPanel as React.ComponentType<unknown>,
  InstallPanel: InstallPanel as React.ComponentType<unknown>,
  PublishPanel: PublishPanel as React.ComponentType<unknown>,
  KnowledgePanel: KnowledgePanel as React.ComponentType<unknown>,
  DocsBrowserPanel: DocsBrowserPanel as React.ComponentType<unknown>,
  TemplateListPanel: TemplateListPanel as React.ComponentType<unknown>,
  ScenarioConfigEditor: ScenarioConfigEditor as React.ComponentType<unknown>,
  PromptEditor: PromptEditor as React.ComponentType<unknown>,
  ScriptEditor: ScriptEditor as React.ComponentType<unknown>,
  DbScriptEditor: DbScriptEditor as React.ComponentType<unknown>,
  ToolDefinitionEditor: ToolDefinitionEditor as React.ComponentType<unknown>,
  ValidationResultPanel: ValidationResultPanel as React.ComponentType<unknown>,
  PreviewPanel: PreviewPanel as React.ComponentType<unknown>,
  BuilderSettingsPanel: BuilderSettingsPanel as React.ComponentType<unknown>,
  BuilderStatusBar: BuilderStatusBar as React.ComponentType<unknown>,
  BuilderStatusIndicator: BuilderStatusIndicator as React.ComponentType<unknown>,
  BuilderWelcomePage: BuilderWelcomePage as React.ComponentType<unknown>,
  DebugPanel: DebugPanel as React.ComponentType<unknown>,
}
