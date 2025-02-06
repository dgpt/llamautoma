import { expect, test, describe, beforeEach } from 'bun:test'
import { HumanMessage, SystemMessage, BaseMessage } from '@langchain/core/messages'
import { entrypoint } from '@langchain/langgraph'
import { RunnableConfig } from '@langchain/core/runnables'
import { createTestContext, waitForResponse, type TestContext } from '../utils'
import { reviewerTask } from '@/ai/tasks/reviewer'
import { ReviewSchema, type Review, type Plan, type GeneratedCode } from 'llamautoma-types'

describe('Reviewer Task Tests', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  test('should approve a well-formed plan', async () => {
    const workflow = entrypoint(
      {
        checkpointer: ctx.memorySaver,
        name: 'reviewer_test',
      },
      async (messages: BaseMessage[], config: RunnableConfig) => {
        const plan: Plan = {
          response: 'Create a React counter component',
          steps: [
            'Ensure Node.js and npm (or yarn) are installed on your system.',
            'Set up a new React project by running "npx create-react-app counter-app" or using Vite, and navigate into the project directory.',
            'Install any additional dependencies if needed (typically React and react-dom are already included).',
            'Create a new file "Counter.js" (or "Counter.jsx") inside the "src" folder for the counter component.',
            'Import React and the useState hook at the top of "Counter.js" with: import React, { useState } from "react";',
            'Define the Counter component as a functional component (using either a function declaration or an arrow function).',
            'Initialize a state variable "count" with useState starting at 0: const [count, setCount] = useState(0);',
            'Define an "increment" function that updates the count using the functional update form: setCount(prevCount => prevCount + 1);',
            'Define a "decrement" function that updates the count similarly: setCount(prevCount => prevCount - 1);',
            'Define a "reset" function that resets the count back to 0 using setCount(0);',
            'Return a JSX structure that displays the current count (e.g., in a <h1> element) and includes three buttons labeled "Increment", "Decrement", and "Reset".',
            'Attach onClick event handlers to each button that call the corresponding functions.',
            'Export the Counter component as the default export using: export default Counter;',
            'Open "App.js" (or another parent component file) and import the Counter component with: import Counter from "./Counter";',
            'Render the Counter component within the JSX returned by the App component (e.g., <Counter />).',
            'Run the development server with "npm start" or "yarn start" and open the application in a browser.',
            'Interact with the counter to verify that the increment, decrement, and reset functions update the state and render correctly.',
            'Review the component to ensure that state updates use the functional update form to prevent issues with asynchronous updates.',
            'Note that no useEffect hook is required for this simple state update scenario; however, if side effects are added later, useEffect should be implemented appropriately.',
            'Optionally, add CSS styling or other enhancements to improve the UI/UX of the counter component.',
            'Commit your changes and document the project steps for future reference and maintenance.',
          ],
        }
        const result = await reviewerTask({
          messages,
          plan,
          config: {
            ...config,
            configurable: {
              thread_id: ctx.threadId,
              checkpoint_ns: 'reviewer_test',
            },
          },
        })
        console.log(`Reviewer result: ${JSON.stringify(result)}`)
        return result
      }
    )

    const messages = [
      new SystemMessage('You are a code reviewer. Review this plan.'),
      new HumanMessage('Create a React counter component'),
    ]

    const result = await waitForResponse(
      workflow.invoke(messages, {
        configurable: {
          thread_id: ctx.threadId,
          checkpoint_ns: 'reviewer_test',
        },
      })
    )
    const review = result as Review

    expect(() => ReviewSchema.parse(review)).not.toThrow()
    expect(review.approved).toBeDefined()
  })

  test('should reject a plan missing critical steps', async () => {
    const workflow = entrypoint(
      {
        name: 'reviewer_test',
      },
      async (messages: BaseMessage[]) => {
        const plan: Plan = {
          response: 'Create a styled React counter component',
          steps: ['Initialize new React project using create-react-app'],
        }
        const result = await reviewerTask({
          messages,
          plan,
        })
        return result
      }
    )

    const messages = [
      new HumanMessage('Create a styled React counter component with increment/decrement buttons'),
    ]

    const result = await waitForResponse(workflow.invoke(messages))
    const review = result as Review

    expect(() => ReviewSchema.parse(review)).not.toThrow()
    expect(review.approved).toBe(false)
    expect(review.feedback).toBeDefined()
  })

  test('should approve well-written code', async () => {
    const workflow = entrypoint(
      {
        checkpointer: ctx.memorySaver,
        name: 'reviewer_test',
      },
      async (messages: BaseMessage[], config: RunnableConfig) => {
        const code: GeneratedCode = {
          files: [
            {
              path: 'src/components/Counter.tsx',
              content: `
import React, { useState } from 'react';

interface CounterProps {
  initialValue?: number;
}

export const Counter: React.FC<CounterProps> = ({ initialValue = 0 }) => {
  const [count, setCount] = useState(initialValue);

  const increment = () => setCount(prev => prev + 1);
  const decrement = () => setCount(prev => prev - 1);

  return (
    <div className="counter">
      <button onClick={decrement}>-</button>
      <span>{count}</span>
      <button onClick={increment}>+</button>
    </div>
  );
};`,
            },
          ],
        }
        const result = await reviewerTask({
          messages,
          code,
          config: {
            ...config,
            configurable: {
              thread_id: ctx.threadId,
              checkpoint_ns: 'reviewer_test',
            },
          },
        })
        return result
      }
    )

    const messages = [
      new SystemMessage('You are a code reviewer. Review this code.'),
      new HumanMessage('Create a React counter component with proper state management'),
    ]

    const result = await waitForResponse(
      workflow.invoke(messages, {
        configurable: {
          thread_id: ctx.threadId,
          checkpoint_ns: 'reviewer_test',
        },
      })
    )
    const review = result as Review

    expect(() => ReviewSchema.parse(review)).not.toThrow()
    expect(review.approved).toBe(true)
  })

  test('should reject code with potential issues', async () => {
    const workflow = entrypoint(
      {
        checkpointer: ctx.memorySaver,
        name: 'reviewer_test',
      },
      async (messages: BaseMessage[], config: RunnableConfig) => {
        const code: GeneratedCode = {
          files: [
            {
              path: 'src/components/Counter.tsx',
              content: `
import React from 'react';

export const Counter = () => {
  let count = 0;  // Using let instead of useState

  const increment = () => count++;  // Direct mutation
  const decrement = () => count--;  // Direct mutation

  return (
    <div>
      <button onClick={decrement}>-</button>
      <span>{count}</span>
      <button onClick={increment}>+</button>
    </div>
  );
};`,
            },
          ],
        }
        const result = await reviewerTask({
          messages,
          code,
          config: {
            ...config,
            configurable: {
              thread_id: ctx.threadId,
              checkpoint_ns: 'reviewer_test',
            },
          },
        })
        return result
      }
    )

    const messages = [
      new SystemMessage('You are a code reviewer. Review this code.'),
      new HumanMessage('Create a React counter component that properly manages state'),
    ]

    const result = await waitForResponse(
      workflow.invoke(messages, {
        configurable: {
          thread_id: ctx.threadId,
          checkpoint_ns: 'reviewer_test',
        },
      })
    )
    const review = result as Review

    expect(() => ReviewSchema.parse(review)).not.toThrow()
    expect(review.approved).toBe(false)
    expect(review.feedback).toBeDefined()
  })
})
