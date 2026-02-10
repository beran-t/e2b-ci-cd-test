// AI Code Review script — runs inside a GitHub Actions workflow
// This follows the guide at docs/use-cases/ci-cd.mdx

import { Sandbox, CommandExitError } from 'e2b'

const repoUrl = `https://github.com/${process.env.PR_REPO}.git`
const prBranch = process.env.PR_BRANCH
const prNumber = process.env.PR_NUMBER
const githubRepo = process.env.GITHUB_REPOSITORY
const githubToken = process.env.GITHUB_TOKEN

console.log(`Reviewing PR #${prNumber} from ${prBranch} on ${process.env.PR_REPO}`)

// Step 1: Create a sandbox with a 5-minute timeout
const sandbox = await Sandbox.create({ timeoutMs: 300_000 })
console.log('Sandbox created:', sandbox.sandboxId)

// Step 2: Clone the PR branch into the sandbox
await sandbox.git.clone(repoUrl, {
  path: '/home/user/repo',
  branch: prBranch,
  username: 'x-access-token',
  password: githubToken,
  depth: 1,
})
console.log('Repository cloned')

// Step 3: Get the diff (for demo, just show the file list since depth=1 has no base to diff against)
const filesResult = await sandbox.commands.run(
  'cd /home/user/repo && git log --oneline -3 && echo "---" && ls -la'
)
console.log('Repo contents:\n', filesResult.stdout)

// Step 4: Run tests in the sandbox
console.log('\n--- Running tests ---')
try {
  await sandbox.commands.run('cd /home/user/repo && npm install --silent', {
    onStdout: (data) => console.log(data),
    onStderr: (data) => console.error(data),
  })
  await sandbox.commands.run('cd /home/user/repo && npm test', {
    onStdout: (data) => console.log(data),
    onStderr: (data) => console.error(data),
  })
  console.log('All tests passed')
} catch (err) {
  if (err instanceof CommandExitError) {
    console.error('Tests failed with exit code:', err.exitCode)
    // In real workflow, post failure comment to PR here
    await sandbox.kill()
    process.exit(1)
  }
  throw err
}

// Step 5: Post result to PR (using GitHub API)
if (githubToken && githubRepo && prNumber) {
  const review = '**AI Review (test run)**\n\nAll tests passed in E2B sandbox. No issues found.'
  const res = await fetch(
    `https://api.github.com/repos/${githubRepo}/issues/${prNumber}/comments`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${githubToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        body: `## AI Code Review\n\n${review}`,
      }),
    }
  )
  if (res.ok) {
    console.log('Posted review comment to PR')
  } else {
    console.error('Failed to post comment:', res.status, await res.text())
  }
}

// Cleanup
await sandbox.kill()
console.log('Done')
