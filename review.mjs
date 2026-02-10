import { Sandbox, CommandExitError } from 'e2b'
import OpenAI from 'openai'

// --- 1. Create sandbox ---
const sandbox = await Sandbox.create({ timeoutMs: 300_000 })
console.log('Sandbox created:', sandbox.sandboxId)

// --- 2. Clone the PR branch ---
const repoUrl = `https://github.com/${process.env.PR_REPO}.git`

await sandbox.git.clone(repoUrl, {
  path: '/home/user/repo',
  branch: process.env.PR_BRANCH,
  username: 'x-access-token',
  password: process.env.GITHUB_TOKEN,
  depth: 1,
})
console.log('Repository cloned')

// --- 3. Get the diff and send it to an LLM for review ---
const diffResult = await sandbox.commands.run(
  'cd /home/user/repo && git log --oneline -5'
)
console.log('Diff stdout:', diffResult.stdout)

let review
if (process.env.OPENAI_API_KEY) {
  const openai = new OpenAI()
  const response = await openai.chat.completions.create({
    model: 'gpt-5.2-mini',
    messages: [
      {
        role: 'system',
        content:
          'You are a senior code reviewer. Analyze the following git diff and provide a concise review with actionable feedback. Focus on bugs, security issues, and code quality.',
      },
      {
        role: 'user',
        content: `Review this diff:\n\n${diffResult.stdout}`,
      },
    ],
  })
  review = response.choices[0].message.content
  console.log('AI Review:', review)
} else {
  review = 'OPENAI_API_KEY not set — skipping LLM call. All E2B steps passed.'
  console.log('Skipping LLM call (no OPENAI_API_KEY)')
}

// --- 4. Run the test suite inside the sandbox ---
await sandbox.commands.run('cd /home/user/repo && npm install', {
  onStdout: (data) => console.log(data),
  onStderr: (data) => console.error(data),
})

try {
  await sandbox.commands.run('cd /home/user/repo && npm test', {
    onStdout: (data) => console.log(data),
    onStderr: (data) => console.error(data),
  })
  console.log('All tests passed')
} catch (err) {
  if (err instanceof CommandExitError) {
    console.error('Tests failed with exit code:', err.exitCode)
    await sandbox.kill()
    process.exit(1)
  }
  throw err
}

// --- 5. Post results as a PR comment ---
const prNumber = process.env.PR_NUMBER
const repo = process.env.GITHUB_REPOSITORY

await fetch(
  `https://api.github.com/repos/${repo}/issues/${prNumber}/comments`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      body: `## AI Code Review\n\n${review}`,
    }),
  }
)

await sandbox.kill()
console.log('Done')
