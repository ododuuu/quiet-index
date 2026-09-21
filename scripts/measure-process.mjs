// --import 預載：量測被測 CLI 本身，不將父程序記憶體算入。
let sampledPeakRss = process.memoryUsage().rss;
const timer = setInterval(() => { sampledPeakRss = Math.max(sampledPeakRss, process.memoryUsage().rss); }, 5);
timer.unref();
process.once('beforeExit', () => {
  clearInterval(timer);
  sampledPeakRss = Math.max(sampledPeakRss, process.memoryUsage().rss);
  if (process.send) process.send({ maxRssKiB: process.resourceUsage().maxRSS, sampledPeakRss, sampleIntervalMs: 5 }, () => process.disconnect());
});
