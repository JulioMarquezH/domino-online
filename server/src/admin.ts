import { main } from './admin-cli';

process.exitCode = main(process.argv.slice(2), process.env);
