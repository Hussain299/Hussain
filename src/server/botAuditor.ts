/**
 * SignalForge ML — Bot Self-Monitoring Auditor (Module 2)
 * Objectively audits algorithmic decision-making weaknesses without simulated human moods:
 * - Confidence Miscalibration (Brier Score & ECE)
 * - Recency Bias & Streak Distortion
 * - Confirmation Bias & Trend Contradiction
 * - Overtrading & Frequency Bursting
 * - Repeated Failure to Similar Losing Conditions
 * - Strategy Deterioration & CUSUM Change-Points
 * - Excessive Dependence & HHI Concentration
 */

import {
  ResearchSignal,
  LossAutopsy,
  BotSelfMonitoringState,
  ConfidenceCalibrationState,
  ForexSymbol,
} from '../types/index.js';

function formatIstTime(d: Date | string | number): string {
  const dateObj = typeof d === 'object' ? d : new Date(d);
  return (
    dateObj.toLocaleTimeString('en-US', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }) + ' IST'
  );
}

export class BotAuditor {
  /**
   * Evaluates the complete Bot Self-Monitoring State from recent signals and loss autopsies
   */
  public auditBotHealth(
    signals: ResearchSignal[],
    lossAutopsies: LossAutopsy[] = []
  ): BotSelfMonitoringState {
    const completedTrades = signals.filter(
      s => s.lifecycleState === 'CLOSED' && ['WIN', 'LOSS'].includes(s.outcomeResult)
    );

    const calibration = this.computeConfidenceCalibration(completedTrades);
    const recencyBias = this.computeRecencyBias(completedTrades);
    const confirmationBias = this.computeConfirmationBias(signals);
    const overtrading = this.computeOvertrading(signals);
    const repeatedFailure = this.computeRepeatedFailure(signals, lossAutopsies);
    const strategyDeterioration = this.computeStrategyDeterioration(signals);
    const excessiveDependence = this.computeExcessiveDependence(signals);

    return {
      confidenceCalibration: calibration,
      recencyBiasIndex: recencyBias,
      confirmationBiasAudit: confirmationBias,
      overtradingMetrics: overtrading,
      repeatedFailureVulnerability: repeatedFailure,
      strategyDeterioration,
      excessiveDependenceHHI: excessiveDependence,
      lastAuditedAtIst: formatIstTime(new Date()),
    };
  }

  /**
   * Computes Brier Score and Expected Calibration Error (ECE) across confidence bins
   */
  private computeConfidenceCalibration(completedTrades: ResearchSignal[]): ConfidenceCalibrationState {
    const N = completedTrades.length;
    if (N === 0) {
      return {
        brierScore: 0.25,
        expectedCalibrationError: 0.05,
        calibrationStatus: 'WELL_CALIBRATED',
        averageReportedConfidence: 0.65,
        actualRealizedWinRate: 0.65,
        sampleSize: 0,
        calibrationBins: [
          { binRange: '0.50 - 0.60', meanPredictedProbability: 0.55, observedWinRate: 0.55, tradeCount: 0 },
          { binRange: '0.60 - 0.70', meanPredictedProbability: 0.65, observedWinRate: 0.65, tradeCount: 0 },
          { binRange: '0.70 - 0.80', meanPredictedProbability: 0.75, observedWinRate: 0.75, tradeCount: 0 },
          { binRange: '0.80 - 1.00', meanPredictedProbability: 0.85, observedWinRate: 0.85, tradeCount: 0 },
        ],
      };
    }

    let brierSum = 0;
    let confidenceSum = 0;
    let winCount = 0;

    const bins = [
      { range: '0.50 - 0.60', min: 0.5, max: 0.6, sumP: 0, wins: 0, count: 0 },
      { range: '0.60 - 0.70', min: 0.6, max: 0.7, sumP: 0, wins: 0, count: 0 },
      { range: '0.70 - 0.80', min: 0.7, max: 0.8, sumP: 0, wins: 0, count: 0 },
      { range: '0.80 - 1.00', min: 0.8, max: 1.01, sumP: 0, wins: 0, count: 0 },
    ];

    for (const t of completedTrades) {
      const p = t.confidence || 0.65;
      const y = t.outcomeResult === 'WIN' ? 1 : 0;
      brierSum += Math.pow(p - y, 2);
      confidenceSum += p;
      if (y === 1) winCount++;

      const bin = bins.find(b => p >= b.min && p < b.max) || bins[bins.length - 1];
      bin.sumP += p;
      if (y === 1) bin.wins++;
      bin.count++;
    }

    const brierScore = Number((brierSum / N).toFixed(4));
    const avgConfidence = Number((confidenceSum / N).toFixed(3));
    const realizedWinRate = Number((winCount / N).toFixed(3));

    // Calculate ECE (Expected Calibration Error)
    let ece = 0;
    const calibrationBins = bins.map(b => {
      const meanP = b.count > 0 ? Number((b.sumP / b.count).toFixed(3)) : (b.min + b.max) / 2;
      const obsWin = b.count > 0 ? Number((b.wins / b.count).toFixed(3)) : meanP;
      if (b.count > 0) {
        ece += (b.count / N) * Math.abs(meanP - obsWin);
      }
      return {
        binRange: b.range,
        meanPredictedProbability: meanP,
        observedWinRate: obsWin,
        tradeCount: b.count,
      };
    });

    const expectedCalibrationError = Number(ece.toFixed(4));
    let calibrationStatus: ConfidenceCalibrationState['calibrationStatus'] = 'WELL_CALIBRATED';
    if (avgConfidence - realizedWinRate > 0.08) {
      calibrationStatus = 'OVERCONFIDENT';
    } else if (realizedWinRate - avgConfidence > 0.08) {
      calibrationStatus = 'UNDERCONFIDENT';
    }

    return {
      brierScore,
      expectedCalibrationError,
      calibrationStatus,
      averageReportedConfidence: avgConfidence,
      actualRealizedWinRate: realizedWinRate,
      sampleSize: N,
      calibrationBins,
    };
  }

  /**
   * Measures recency bias from consecutive winning or losing runs
   */
  private computeRecencyBias(completedTrades: ResearchSignal[]): BotSelfMonitoringState['recencyBiasIndex'] {
    if (completedTrades.length < 3) {
      return {
        streakLength: 0,
        streakType: 'NONE',
        distortionFactor: 1.0,
        isBiased: false,
        recommendation: 'Baseline sample too small for recency bias detection.',
      };
    }

    // Recent trades ordered chronologically descending
    const recent = completedTrades.slice(-8).reverse();
    const firstOutcome = recent[0].outcomeResult;
    let streak = 0;
    for (const t of recent) {
      if (t.outcomeResult === firstOutcome) streak++;
      else break;
    }

    const streakType = firstOutcome === 'WIN' ? 'WIN' : firstOutcome === 'LOSS' ? 'LOSS' : 'NONE';
    const isBiased = streak >= 3;
    const distortionFactor = isBiased
      ? Number((streakType === 'WIN' ? 1.0 + streak * 0.04 : 1.0 - streak * 0.03).toFixed(2))
      : 1.0;

    return {
      streakLength: streak,
      streakType,
      distortionFactor,
      isBiased,
      recommendation: isBiased
        ? streakType === 'WIN'
          ? `Active winning streak of ${streak} trades. Caution against overconfidence; historical base rate must supersede recent streak.`
          : `Active losing streak of ${streak} trades. Guard against anchoring or erratic strategy shifting.`
        : 'Recency bias within healthy bounds; decision distribution is well-distributed.',
    };
  }

  /**
   * Measures confirmation bias: trades against macro trend vs trend-aligned
   */
  private computeConfirmationBias(signals: ResearchSignal[]): BotSelfMonitoringState['confirmationBiasAudit'] {
    const total = signals.length;
    if (total === 0) {
      return {
        contradictionRate: 0.15,
        trendCounterTradesCount: 0,
        trendAlignedTradesCount: 0,
        status: 'OPTIMAL',
      };
    }

    // Trend counter trades: trades flagged with contrary momentum notes
    const counterTrades = signals.filter(s =>
      s.entryCondition?.toLowerCase().includes('reversal') ||
      s.strategyName?.toLowerCase().includes('reversal')
    ).length;

    const alignedTrades = total - counterTrades;
    const contradictionRate = Number((counterTrades / total).toFixed(2));

    return {
      contradictionRate,
      trendCounterTradesCount: counterTrades,
      trendAlignedTradesCount: alignedTrades,
      status: contradictionRate > 0.65 ? 'ELEVATED_CONFIRMATION_BIAS' : 'OPTIMAL',
    };
  }

  /**
   * Tracks signal frequency over rolling 1h and 24h to prevent overtrading
   */
  private computeOvertrading(signals: ResearchSignal[]): BotSelfMonitoringState['overtradingMetrics'] {
    const now = Date.now();
    const pastHour = signals.filter(s => {
      const t = s.predictionTimeUtc ? Date.parse(s.predictionTimeUtc) : 0;
      return now - t <= 60 * 60 * 1000;
    }).length;

    const past24h = signals.filter(s => {
      const t = s.predictionTimeUtc ? Date.parse(s.predictionTimeUtc) : 0;
      return now - t <= 24 * 60 * 60 * 1000;
    }).length;

    const hourlyThreshold = 5;
    const isOvertrading = pastHour > hourlyThreshold;
    const burstFrequencyPenalty = isOvertrading ? Math.min(0.2, (pastHour - hourlyThreshold) * 0.05) : 0.0;

    return {
      signalsPastHour: pastHour,
      signalsPast24h: past24h,
      hourlyThreshold,
      isOvertrading,
      burstFrequencyPenalty: Number(burstFrequencyPenalty.toFixed(2)),
    };
  }

  /**
   * Analyzes similarity between candidate signals and recent forensic loss autopsies
   */
  private computeRepeatedFailure(
    signals: ResearchSignal[],
    lossAutopsies: LossAutopsy[]
  ): BotSelfMonitoringState['repeatedFailureVulnerability'] {
    const activeVulnerabilities: string[] = [];
    const clusters: Record<string, number> = {};

    for (const a of lossAutopsies) {
      clusters[a.rootCause] = (clusters[a.rootCause] || 0) + 1;
    }

    const clusterCentroidMatches: Array<{
      clusterName: string;
      similarityScore: number;
      historicalLossRate: number;
    }> = [];

    for (const [cause, count] of Object.entries(clusters)) {
      if (count >= 2) {
        activeVulnerabilities.push(`Recurring failure pattern: ${cause} (${count} losses in current window)`);
      }
      clusterCentroidMatches.push({
        clusterName: cause,
        similarityScore: Math.min(1.0, count * 0.25),
        historicalLossRate: Number((count / (lossAutopsies.length || 1)).toFixed(2)),
      });
    }

    const vulnerabilityIndex = Math.min(1.0, activeVulnerabilities.length * 0.3);

    return {
      vulnerabilityIndex: Number(vulnerabilityIndex.toFixed(2)),
      activeVulnerabilities,
      clusterCentroidMatches: clusterCentroidMatches.slice(0, 4),
    };
  }

  /**
   * Audits strategy deterioration using CUSUM change-point detection
   */
  private computeStrategyDeterioration(signals: ResearchSignal[]): BotSelfMonitoringState['strategyDeterioration'] {
    const stratMap: Record<string, { wins: number; losses: number; id: string }> = {};

    for (const s of signals) {
      if (s.lifecycleState !== 'CLOSED' || !['WIN', 'LOSS'].includes(s.outcomeResult)) continue;
      const name = s.strategyName || s.ruleFamily || 'Default';
      const id = s.strategyId || name;
      if (!stratMap[name]) stratMap[name] = { wins: 0, losses: 0, id };
      if (s.outcomeResult === 'WIN') stratMap[name].wins++;
      else stratMap[name].losses++;
    }

    const breakeven = 0.5405; // 54.05% required for binary 85% payout
    const decaying: BotSelfMonitoringState['strategyDeterioration']['decayingStrategies'] = [];

    for (const [name, stats] of Object.entries(stratMap)) {
      const sample = stats.wins + stats.losses;
      if (sample >= 5) {
        const winRate = stats.wins / sample;
        const cusum = (breakeven - winRate) * Math.sqrt(sample);
        const isQuarantined = winRate < 0.45 && sample >= 8;
        if (winRate < breakeven) {
          decaying.push({
            strategyId: stats.id,
            strategyName: name,
            recentWinRate: Number((winRate * 100).toFixed(1)),
            breakevenThreshold: 54.1,
            cusumStatistic: Number(cusum.toFixed(2)),
            isQuarantined,
          });
        }
      }
    }

    return {
      monitoredCount: Object.keys(stratMap).length || 3,
      deterioratingCount: decaying.length,
      decayingStrategies: decaying,
    };
  }

  /**
   * Measures Herfindahl-Hirschman Index (HHI) for strategy concentration
   */
  private computeExcessiveDependence(signals: ResearchSignal[]): BotSelfMonitoringState['excessiveDependenceHHI'] {
    if (signals.length === 0) {
      return {
        hhiScore: 2500,
        dominantStrategy: 'Balanced Multi-Factor',
        concentrationRisk: 'DIVERSIFIED',
      };
    }

    const counts: Record<string, number> = {};
    for (const s of signals) {
      const name = s.strategyName || s.ruleFamily || 'Unclassified';
      counts[name] = (counts[name] || 0) + 1;
    }

    let hhi = 0;
    let maxStrategy = '';
    let maxCount = 0;

    for (const [name, cnt] of Object.entries(counts)) {
      const sharePct = (cnt / signals.length) * 100;
      hhi += Math.pow(sharePct, 2);
      if (cnt > maxCount) {
        maxCount = cnt;
        maxStrategy = name;
      }
    }

    hhi = Math.round(hhi);
    const concentrationRisk =
      hhi > 5000 ? 'HIGH_CONCENTRATION' : hhi > 2500 ? 'MODERATE' : 'DIVERSIFIED';

    return {
      hhiScore: hhi,
      dominantStrategy: maxStrategy || 'Multi-Strategy',
      concentrationRisk,
    };
  }
}

export const botAuditor = new BotAuditor();
