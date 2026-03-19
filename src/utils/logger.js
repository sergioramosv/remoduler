import chalk from 'chalk';

const AGENT_COLORS = {
  PLANNER: chalk.blue,
  ARCHITECT: chalk.cyan,
  CODER: chalk.green,
  TESTER: chalk.yellow,
  SECURITY: chalk.magenta,
  REVIEWER: chalk.red,
  REMODULER: chalk.white.bold,
};

function ts() {
  return chalk.gray(new Date().toLocaleTimeString('es-ES'));
}

function agentTag(agent) {
  const colorFn = AGENT_COLORS[agent] || chalk.white;
  return colorFn(`[${agent}]`);
}

export const logger = {
  info(msg, agent) {
    console.log(`${ts()} ${chalk.blue('INF')} ${agent ? agentTag(agent) + ' ' : ''}${msg}`);
  },

  success(msg, agent) {
    console.log(`${ts()} ${chalk.green('OK!')} ${agent ? agentTag(agent) + ' ' : ''}${msg}`);
  },

  warn(msg, agent) {
    console.warn(`${ts()} ${chalk.yellow('WRN')} ${agent ? agentTag(agent) + ' ' : ''}${msg}`);
  },

  error(msg, agent) {
    console.error(`${ts()} ${chalk.red('ERR')} ${agent ? agentTag(agent) + ' ' : ''}${msg}`);
  },

  taskHeader(taskTitle) {
    const line = '─'.repeat(60);
    console.log(chalk.white.bold(`\n${line}\n  ${taskTitle}\n${line}\n`));
  },
};
