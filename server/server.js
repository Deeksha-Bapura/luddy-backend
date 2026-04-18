const express = require("express");
const cors = require("cors");

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;

    performanceLogs.push({
      method: req.method,
      endpoint: req.originalUrl,
      duration
    });
  });

  next();
});

// In-memory storage
let submissions = [];
let performanceLogs = [];

const judges = [
  { username: "judge1", password: "pass123" },
  { username: "judge2", password: "pass123" },
  { username: "judge3", password: "pass123" }
];

// Home route
app.get("/", (req, res) => {
  res.send("Luddy Hackathon Leaderboard API is running");
});

// Add score submission
app.post("/add", (req, res) => {
  const { teamName, judgeId, innovation, technical, presentation } = req.body;

  // Basic validation
  if (!teamName || !judgeId || innovation == null || technical == null || presentation == null) {
    return res.status(400).json({
      error: "Missing required fields: teamName, judgeId, innovation, technical, presentation"
    });
  }

  const totalScore = innovation + technical + presentation;

  const newSubmission = {
    teamName,
    judgeId,
    innovation,
    technical,
    presentation,
    totalScore,
    timestamp: new Date().toISOString()
  };

  submissions.push(newSubmission);

  return res.status(201).json({
  success: true,
  message: "Score submitted successfully",
  teamName,
  totalScore,
  timestamp: newSubmission.timestamp
});
});

// Temporary route to view all submissions
app.get("/submissions", (req, res) => {
  res.json(submissions);
});
// Leaderboard route
// Leaderboard route
app.get("/leaderboard", (req, res) => {
  if (submissions.length === 0) {
    return res.json([]);
  }

  const teamMap = {};

  submissions.forEach((entry) => {
    const team = entry.teamName.trim();

    if (!teamMap[team]) {
      teamMap[team] = {
        teamName: team,
        totalScore: 0,
        submissionCount: 0,
        judges: new Set()
      };
    }

    teamMap[team].totalScore += entry.totalScore;
    teamMap[team].submissionCount += 1;
    teamMap[team].judges.add(entry.judgeId);
  });

  const leaderboard = Object.values(teamMap).map((team) => {
    const averageScore = team.totalScore / team.submissionCount;

    return {
      teamName: team.teamName,
      totalScore: team.totalScore,
      averageScore: Number(averageScore.toFixed(2)),
      submissionCount: team.submissionCount,
      status: team.submissionCount >= 3 ? "Complete" : "Pending"
    };
  });

  leaderboard.sort((a, b) => {
    if (b.totalScore !== a.totalScore) {
      return b.totalScore - a.totalScore;
    }
    return b.averageScore - a.averageScore;
  });

  const rankedLeaderboard = leaderboard.map((team, index) => ({
    rank: index + 1,
    ...team
  }));

  res.json(rankedLeaderboard.slice(0, 10));
});
// Remove all submissions for a team
app.delete("/remove/:teamName", (req, res) => {
  const teamName = req.params.teamName;

  const initialLength = submissions.length;

  submissions = submissions.filter(
    (entry) => entry.teamName.toLowerCase() !== teamName.toLowerCase()
  );

  const removedCount = initialLength - submissions.length;

  if (removedCount === 0) {
    return res.status(404).json({
      message: `No submissions found for team '${teamName}'`
    });
  }

  res.json({
    message: `Removed ${removedCount} submission(s) for team '${teamName}'`
  });
});
// Info route - statistics for all submissions
app.get("/info", (req, res) => {
  if (submissions.length === 0) {
    return res.json({
      message: "No submissions available",
      totalSubmissions: 0
    });
  }

  const scores = submissions.map((entry) => entry.totalScore).sort((a, b) => a - b);
  const n = scores.length;

  const mean = scores.reduce((sum, score) => sum + score, 0) / n;

  const median =
    n % 2 === 0
      ? (scores[n / 2 - 1] + scores[n / 2]) / 2
      : scores[Math.floor(n / 2)];

  const min = scores[0];
  const max = scores[n - 1];

  const getMedian = (arr) => {
    const len = arr.length;
    if (len === 0) return 0;
    return len % 2 === 0
      ? (arr[len / 2 - 1] + arr[len / 2]) / 2
      : arr[Math.floor(len / 2)];
  };

  const lowerHalf = scores.slice(0, Math.floor(n / 2));
  const upperHalf = scores.slice(Math.ceil(n / 2));

  const q1 = getMedian(lowerHalf);
  const q3 = getMedian(upperHalf);

  const variance =
    scores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / n;
  const standardDeviation = Math.sqrt(variance);

  const distribution = {
    low: scores.filter((score) => score < 10).length,
    medium: scores.filter((score) => score >= 10 && score < 20).length,
    high: scores.filter((score) => score >= 20).length
  };

  res.json({
    totalSubmissions: n,
    mean: Number(mean.toFixed(2)),
    median,
    min,
    max,
    quartiles: {
      q1,
      q2: median,
      q3
    },
    standardDeviation: Number(standardDeviation.toFixed(2)),
    distribution
  });
});
// Performance route
app.get("/performance", (req, res) => {
  if (performanceLogs.length === 0) {
    return res.json({
      message: "No performance data available yet",
      totalRequests: 0
    });
  }

  const totalTime = performanceLogs.reduce((sum, log) => sum + log.duration, 0);
  const averageTime = totalTime / performanceLogs.length;

  res.json({
    totalRequests: performanceLogs.length,
    averageExecutionTimeMs: Number(averageTime.toFixed(2)),
    logs: performanceLogs
  });
});
// History route
app.get("/history", (req, res) => {
  const { limit } = req.query;

  let sorted = [...submissions].sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  );

  if (limit) {
    sorted = sorted.slice(0, Number(limit));
  }

  res.json({
    totalRecords: sorted.length,
    history: sorted
  });
});
// Judge login route
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      message: "Username and password are required"
    });
  }

  const judge = judges.find(
    (j) => j.username === username && j.password === password
  );

  if (!judge) {
    return res.status(401).json({
      message: "Invalid credentials"
    });
  }

  res.json({
    message: "Login successful",
    role: "judge",
    username: judge.username
  });
});
// Dashboard route
app.get("/dashboard", (req, res) => {
  if (submissions.length === 0) {
    return res.json({
      summary: {
        totalTeams: 0,
        totalJudges: 0,
        lastUpdated: null
      },
      topThree: [],
      recentUpdates: [],
      stats: {
        mean: 0,
        median: 0,
        standardDeviation: 0
      },
      tableData: []
    });
  }

  // ---------- Summary ----------
  const uniqueTeams = new Set(submissions.map((entry) => entry.teamName.trim()));
  const uniqueJudges = new Set(submissions.map((entry) => entry.judgeId.trim()));

  const sortedByTime = [...submissions].sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  );

  const lastUpdated = sortedByTime[0]?.timestamp || null;

  // ---------- Team Aggregation ----------
  const teamMap = {};

  submissions.forEach((entry) => {
    const team = entry.teamName.trim();

    if (!teamMap[team]) {
      teamMap[team] = {
        teamName: team,
        totalScore: 0,
        submissionCount: 0
      };
    }

    teamMap[team].totalScore += entry.totalScore;
    teamMap[team].submissionCount += 1;
  });

  let tableData = Object.values(teamMap).map((team) => {
    const averageScore = team.totalScore / team.submissionCount;

    return {
      teamName: team.teamName,
      totalScore: team.totalScore,
      averageScore: Number(averageScore.toFixed(2)),
      submissionCount: team.submissionCount,
      status: team.submissionCount >= 3 ? "Complete" : "Pending"
    };
  });

  tableData.sort((a, b) => {
    if (b.totalScore !== a.totalScore) {
      return b.totalScore - a.totalScore;
    }
    return b.averageScore - a.averageScore;
  });

  tableData = tableData.map((team, index) => ({
    rank: index + 1,
    ...team
  }));

  const topThree = tableData.slice(0, 3);

  // ---------- Recent Updates ----------
  const recentUpdates = sortedByTime.slice(0, 5).map((entry) => ({
    judgeId: entry.judgeId,
    teamName: entry.teamName,
    totalScore: entry.totalScore,
    timestamp: entry.timestamp
  }));

  // ---------- Stats ----------
  const teamTotals = tableData.map((team) => team.totalScore).sort((a, b) => a - b);
  const n = teamTotals.length;

  const mean = teamTotals.reduce((sum, score) => sum + score, 0) / n;

  const median =
    n % 2 === 0
      ? (teamTotals[n / 2 - 1] + teamTotals[n / 2]) / 2
      : teamTotals[Math.floor(n / 2)];

  const variance =
    teamTotals.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / n;

  const standardDeviation = Math.sqrt(variance);

  res.json({
    summary: {
      totalTeams: uniqueTeams.size,
      totalJudges: uniqueJudges.size,
      lastUpdated
    },
    topThree,
    recentUpdates,
    stats: {
      mean: Number(mean.toFixed(2)),
      median: Number(median.toFixed(2)),
      standardDeviation: Number(standardDeviation.toFixed(2))
    },
    tableData
  });
});
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});