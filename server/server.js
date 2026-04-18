require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Judge = require("./models/Judge");

const app = express();
const PORT = process.env.PORT || 5000;

// Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Submission Schema
const submissionSchema = new mongoose.Schema({
  teamName: String,
  judgeId: String,
  innovation: Number,
  technical: Number,
  presentation: Number,
  impact: Number,
  totalScore: Number,
  timestamp: { type: Date, default: Date.now },
});

const Submission = mongoose.model("Submission", submissionSchema);

app.use(cors());
app.use(express.json());

// Performance logs (in-memory is fine)
let performanceLogs = [];

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    performanceLogs.push({
      method: req.method,
      endpoint: req.originalUrl,
      duration: Date.now() - start,
    });
  });
  next();
});

// Home route
app.get("/", (req, res) => {
  res.send("Luddy Hackathon Leaderboard API is running");
});

// Register route
app.post("/register", async (req, res) => {
  const { username, password, adminSecret } = req.body;

  if (!username || !password || !adminSecret) {
    return res.status(400).json({ message: "Username, password and admin secret are required" });
  }

  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ message: "Invalid admin secret" });
  }

  const existing = await Judge.findOne({ username });
  if (existing) {
    return res.status(409).json({ message: "Username already taken" });
  }

  const hashed = await bcrypt.hash(password, 10);
  const judge = await Judge.create({ username, password: hashed });

  res.status(201).json({ message: "Judge registered successfully", username: judge.username });
});

// Login route
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: "Username and password are required" });
  }

  const judge = await Judge.findOne({ username });
  if (!judge) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const isMatch = await bcrypt.compare(password, judge.password);
  if (!isMatch) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  res.json({ message: "Login successful", role: judge.role, username: judge.username });
});

// Add score submission
app.post("/add", async (req, res) => {
  const { teamName, judgeId, innovation, technical, presentation, impact } = req.body;

  if (!teamName || !judgeId || innovation == null || technical == null || presentation == null || impact == null) {
    return res.status(400).json({
      error: "Missing required fields: teamName, judgeId, innovation, technical, presentation, impact",
    });
  }

  const totalScore = innovation + technical + presentation + impact;

  const newSubmission = new Submission({
    teamName,
    judgeId,
    innovation,
    technical,
    presentation,
    impact,
    totalScore,
  });

  await newSubmission.save();

  return res.status(201).json({
    success: true,
    message: "Score submitted successfully",
    teamName,
    totalScore,
    timestamp: newSubmission.timestamp,
  });
});

// View all submissions
app.get("/submissions", async (req, res) => {
  const submissions = await Submission.find();
  res.json(submissions);
});

// Leaderboard route
app.get("/leaderboard", async (req, res) => {
  const submissions = await Submission.find();

  if (submissions.length === 0) return res.json([]);

  const teamMap = {};
  submissions.forEach((entry) => {
    const team = entry.teamName.trim();
    if (!teamMap[team]) {
      teamMap[team] = { teamName: team, totalScore: 0, submissionCount: 0, judges: new Set() };
    }
    teamMap[team].totalScore += entry.totalScore;
    teamMap[team].submissionCount += 1;
    teamMap[team].judges.add(entry.judgeId);
  });

  const leaderboard = Object.values(teamMap)
    .map((team) => ({
      teamName: team.teamName,
      totalScore: team.totalScore,
      averageScore: Number((team.totalScore / team.submissionCount).toFixed(2)),
      submissionCount: team.submissionCount,
      uniqueJudges: team.judges.size,
      status: team.judges.size >= 3 ? "Complete" : "Pending",
    }))
    .sort((a, b) => b.totalScore - a.totalScore || b.averageScore - a.averageScore)
    .map((team, index) => ({ rank: index + 1, ...team }));

  res.json(leaderboard.slice(0, 10));
});

// Remove team
app.delete("/remove/:teamName", async (req, res) => {
  const teamName = req.params.teamName;

  const result = await Submission.deleteMany({
    teamName: { $regex: new RegExp(`^${teamName}$`, "i") },
  });

  if (result.deletedCount === 0) {
    return res.status(404).json({ message: `No submissions found for team '${teamName}'` });
  }

  res.json({ message: `Removed ${result.deletedCount} submission(s) for team '${teamName}'` });
});

// Info route
app.get("/info", async (req, res) => {
  const submissions = await Submission.find();

  if (submissions.length === 0) {
    return res.json({ message: "No submissions available", totalSubmissions: 0 });
  }

  const scores = submissions.map((e) => e.totalScore).sort((a, b) => a - b);
  const n = scores.length;
  const mean = scores.reduce((sum, s) => sum + s, 0) / n;
  const median = n % 2 === 0 ? (scores[n / 2 - 1] + scores[n / 2]) / 2 : scores[Math.floor(n / 2)];
  const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / n;

  const getMedian = (arr) => {
    const len = arr.length;
    if (len === 0) return 0;
    return len % 2 === 0 ? (arr[len / 2 - 1] + arr[len / 2]) / 2 : arr[Math.floor(len / 2)];
  };

  const lowerHalf = scores.slice(0, Math.floor(n / 2));
  const upperHalf = scores.slice(Math.ceil(n / 2));

  res.json({
    totalSubmissions: n,
    mean: Number(mean.toFixed(2)),
    median,
    min: scores[0],
    max: scores[n - 1],
    quartiles: {
      q1: getMedian(lowerHalf),
      q2: median,
      q3: getMedian(upperHalf),
    },
    standardDeviation: Number(Math.sqrt(variance).toFixed(2)),
    distribution: {
      low: scores.filter((s) => s < 10).length,
      medium: scores.filter((s) => s >= 10 && s < 20).length,
      high: scores.filter((s) => s >= 20).length,
    },
  });
});

// Performance route
app.get("/performance", (req, res) => {
  if (performanceLogs.length === 0) {
    return res.json({ message: "No performance data available yet", totalRequests: 0 });
  }

  const totalTime = performanceLogs.reduce((sum, log) => sum + log.duration, 0);

  res.json({
    totalRequests: performanceLogs.length,
    averageExecutionTimeMs: Number((totalTime / performanceLogs.length).toFixed(2)),
    logs: performanceLogs,
  });
});

// History route
app.get("/history", async (req, res) => {
  const { limit, startDate, endDate, judgeId } = req.query;

  let filter = {};

  if (judgeId) filter.judgeId = judgeId;

  if (startDate || endDate) {
    filter.timestamp = {};
    if (startDate) filter.timestamp.$gte = new Date(startDate);
    if (endDate) filter.timestamp.$lte = new Date(endDate);
  }

  let query = Submission.find(filter).sort({ timestamp: -1 });
  if (limit) query = query.limit(Number(limit));

  const history = await query;

  res.json({ totalRecords: history.length, history });
});

// Dashboard route
app.get("/dashboard", async (req, res) => {
  const submissions = await Submission.find();

  if (submissions.length === 0) {
    return res.json({
      summary: { totalTeams: 0, totalJudges: 0, lastUpdated: null },
      topThree: [],
      liveStats: {
        leadingTeam: null,
        gap: 0,
        teamsCompleted: 0,
        teamsPending: 0,
      },
      recentUpdates: [],
      stats: { mean: 0, median: 0, standardDeviation: 0 },
      tableData: [],
    });
  }

  const uniqueTeams = new Set(submissions.map((e) => e.teamName.trim()));
  const uniqueJudges = new Set(submissions.map((e) => e.judgeId.trim()));
  const sortedByTime = [...submissions].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const teamMap = {};
  submissions.forEach((entry) => {
    const team = entry.teamName.trim();
    if (!teamMap[team]) {
      teamMap[team] = { teamName: team, totalScore: 0, submissionCount: 0, judges: new Set() };
    }
    teamMap[team].totalScore += entry.totalScore;
    teamMap[team].submissionCount += 1;
    teamMap[team].judges.add(entry.judgeId);
  });

  let tableData = Object.values(teamMap)
    .map((team) => ({
      teamName: team.teamName,
      totalScore: team.totalScore,
      averageScore: Number((team.totalScore / team.submissionCount).toFixed(2)),
      submissionCount: team.submissionCount,
      uniqueJudges: team.judges.size,
      status: team.judges.size >= 3 ? "Complete" : "Pending",
    }))
    .sort((a, b) => b.totalScore - a.totalScore || b.averageScore - a.averageScore)
    .map((team, index) => ({ rank: index + 1, ...team }));

  const topThree = tableData.slice(0, 3);

  const recentUpdates = sortedByTime.slice(0, 5).map((entry) => ({
    judgeId: entry.judgeId,
    teamName: entry.teamName,
    totalScore: entry.totalScore,
    timestamp: entry.timestamp,
  }));

  const teamTotals = tableData.map((t) => t.totalScore).sort((a, b) => a - b);
  const n = teamTotals.length;
  const mean = teamTotals.reduce((sum, s) => sum + s, 0) / n;
  const median = n % 2 === 0 ? (teamTotals[n / 2 - 1] + teamTotals[n / 2]) / 2 : teamTotals[Math.floor(n / 2)];
  const variance = teamTotals.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / n;

  // Live Stats
  const leading = tableData[0] || null;
  const gap = tableData.length >= 2 ? tableData[0].totalScore - tableData[1].totalScore : 0;
  const teamsCompleted = tableData.filter((t) => t.status === "Complete").length;
  const teamsPending = tableData.filter((t) => t.status === "Pending").length;

  res.json({
    summary: {
      totalTeams: uniqueTeams.size,
      totalJudges: uniqueJudges.size,
      lastUpdated: sortedByTime[0]?.timestamp || null,
    },
    topThree,
    liveStats: {
      leadingTeam: leading ? { teamName: leading.teamName, totalScore: leading.totalScore } : null,
      gap,
      teamsCompleted,
      teamsPending,
    },
    recentUpdates,
    stats: {
      mean: Number(mean.toFixed(2)),
      median: Number(median.toFixed(2)),
      standardDeviation: Number(Math.sqrt(variance).toFixed(2)),
    },
    tableData,
  });
});

// Update a submission
app.put("/update/:id", async (req, res) => {
  const { innovation, technical, presentation, impact } = req.body;

  if (innovation == null || technical == null || presentation == null || impact == null) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const totalScore = innovation + technical + presentation + impact;

  const updated = await Submission.findByIdAndUpdate(
    req.params.id,
    { innovation, technical, presentation, impact, totalScore },
    { new: true }
  );

  if (!updated) {
    return res.status(404).json({ message: "Submission not found" });
  }

  res.json({ message: "Score updated successfully", submission: updated });
});

// Delete a single submission by ID
app.delete("/delete/:id", async (req, res) => {
  const deleted = await Submission.findByIdAndDelete(req.params.id);

  if (!deleted) {
    return res.status(404).json({ message: "Submission not found" });
  }

  res.json({ message: "Submission deleted successfully" });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});