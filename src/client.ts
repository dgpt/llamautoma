import { BaseMessage, HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages'
import { logger } from '@/utils/logger'
import { v4 as uuidv4 } from 'uuid'
import { createReActAgent } from '@/agents/react/agent'
import { MemorySaver } from '@langchain/langgraph-checkpoint'
import { ChatOllama } from '@langchain/ollama'
import { DEFAULT_AGENT_CONFIG } from '@/agents/react/types'

// ... rest of the file