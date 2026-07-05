import { getWarmupLimit, calculateWarmupDay } from './src/utils/warmup.util';

const day = calculateWarmupDay();
console.log('Day:', day);
console.log('Limit:', getWarmupLimit(day, 32));
