import {
  Files, Search, GitBranch, Settings, Sparkles, AlertCircle, ListTree, History,
  Brain, Terminal, Database, BarChart3, Users, FolderTree, Code2, PenTool,
  Globe, Cpu, Layers, Zap, BookOpen, FileText, Image, Music, Video, Mail,
  Calendar, Map, PieChart, TrendingUp, Activity, Shield, Key, Cloud,
  Monitor, Smartphone, Server, Home, Star, Heart, MessageSquare, Bell,
  CheckSquare, Filter, Command, Link, ExternalLink, Copy, Trash2, Plus,
  Minus, Edit, Eye, Download, Upload, RefreshCw, ChevronRight, ChevronDown,
  X, Menu, MoreHorizontal, ArrowRight, ArrowLeft, Play, Pause, SkipForward,
  Volume2, Mic, Camera, Wifi, Bluetooth, Battery, Clock, Tag, Bookmark,
  Hash, AtSign, Send, Inbox, Archive, Trash, Spam, Move, Layout, Grid,
  SidebarOpen, PanelLeft, PanelRight, Maximize2, Minimize2, Expand,
  Workflow, GitMerge, GitPullRequest, Bug, TestTube, Beaker, Rocket,
  Package, Box, Container, Database as DatabaseIcon, HardDrive, Server as ServerIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export const LUCIDE_ICON_MAP: Record<string, LucideIcon> = {
  Files, Search, GitBranch, Settings, Sparkles, AlertCircle, ListTree, History,
  Brain, Terminal, Database, BarChart3, Users, FolderTree, Code2, PenTool,
  Globe, Cpu, Layers, Zap, BookOpen, FileText, Image, Music, Video, Mail,
  Calendar, Map, PieChart, TrendingUp, Activity, Shield, Key, Cloud,
  Monitor, Smartphone, Server, Home, Star, Heart, MessageSquare, Bell,
  CheckSquare, Filter, Command, Link, ExternalLink, Copy, Trash2, Plus,
  Minus, Edit, Eye, Download, Upload, RefreshCw, ChevronRight, ChevronDown,
  X, Menu, MoreHorizontal, ArrowRight, ArrowLeft, Play, Pause, SkipForward,
  Volume2, Mic, Camera, Wifi, Bluetooth, Battery, Clock, Tag, Bookmark,
  Hash, AtSign, Send, Inbox, Archive, Trash, Move, Layout, Grid,
  SidebarOpen, PanelLeft, PanelRight, Maximize2, Minimize2, Expand,
  Workflow, GitMerge, GitPullRequest, Bug, TestTube, Beaker, Rocket,
  Package, Box, Container, DatabaseIcon, HardDrive, ServerIcon,
}

export function getLucideIcon(name: string): LucideIcon {
  return LUCIDE_ICON_MAP[name] || Sparkles
}
