import * as core from "@actions/core";
import * as path from 'path';

import { IActionInputs, ISqlActionInputs, IDacpacActionInputs, IBuildAndPublishInputs, ActionType, SqlPackageAction } from "./AzureSqlAction";
import AzureSqlActionHelper from "./AzureSqlActionHelper";
import SqlConnectionStringBuilder from "./SqlConnectionStringBuilder";
import Constants from "./Constants";
import sql from 'mssql'
import fs from 'fs'

export default async function run() {
    try {
        let inputs = getInputs() as ISqlActionInputs;

        const sqlConfig = {
            user: inputs.connectionString.userId,
            password: inputs.connectionString.password,
            database: inputs.connectionString.database,
            server: inputs.connectionString.server.split(',')[0],
            port: +inputs.connectionString.server.split(',')[1],
            connectionTimeout: 100000,
            pool: {
              max: 10,
              min: 0,
              idleTimeoutMillis: 30000
            },
            options: {
              encrypt: false, // for azure
              trustServerCertificate: true // change to true for local dev / self-signed certs
            }
          }
    
        const sqlText = fs.readFileSync(inputs.sqlFile, "utf-8");

        const pool = await sql.connect(sqlConfig)

        const transaction = new sql.Transaction(pool)
        
        transaction.begin(err => {
            // ... error checks
            let rolledBack = false

            transaction.on('rollback', aborted => {
                // emited with aborted === true
                rolledBack = true
            })

            new sql.Request(transaction)
                .batch(sqlText, (err, result) => {
                    // insert should fail because of invalid value
                    console.log(err)
                    console.log(result)

                    if (err) {
                        if (!rolledBack) {
                            transaction.rollback(err => {
                                console.log(err)
                                console.log('Roll backed')
                            })
                        }
                    } else {
                        transaction.commit(err => {
                            console.log(err)
                            console.log('Transaction committed')
                        })
                    }
                })
        })
    }
    catch (error) {
        core.error(error)
        core.setFailed(error.message);
    }
}

function getInputs(): IActionInputs {
    core.debug('Get action inputs.');

    let connectionString = core.getInput('connection-string', { required: true });
    let connectionStringBuilder = new SqlConnectionStringBuilder(connectionString);
    
    let serverName = core.getInput('server-name', { required: false });
    if ((!!serverName && !!connectionStringBuilder.server) && (serverName != connectionStringBuilder.server)) 
        core.debug("'server-name' is conflicting with 'server' property specified in the connection string. 'server-name' will take precedence.");
    
    // if serverName has not been specified, use the server name from the connection string
    if (!serverName) serverName = connectionStringBuilder.server;    

    let additionalArguments = core.getInput('arguments');

    let dacpacPackage = core.getInput('dacpac-package');
    if (!!dacpacPackage) {
        dacpacPackage = AzureSqlActionHelper.resolveFilePath(dacpacPackage);
        if (path.extname(dacpacPackage).toLowerCase() !== Constants.dacpacExtension) {
            throw new Error(`Invalid dacpac file path provided as input ${dacpacPackage}`);
        }

        if (!serverName) {
            throw new Error(`Missing server name or address in the configuration.`);
        }
    
        return {
            serverName: serverName,
            connectionString: connectionStringBuilder,
            dacpacPackage: dacpacPackage,
            sqlpackageAction: SqlPackageAction.Publish,
            actionType: ActionType.DacpacAction,
            additionalArguments: additionalArguments
        } as IDacpacActionInputs;
    }

    let sqlFilePath = core.getInput('sql-file');
    if (!!sqlFilePath) {
        sqlFilePath = AzureSqlActionHelper.resolveFilePath(sqlFilePath);
        if (path.extname(sqlFilePath).toLowerCase() !== '.sql') {
            throw new Error(`Invalid sql file path provided as input ${sqlFilePath}`);
        }

        if (!serverName) {
            throw new Error(`Missing server name or address in the configuration.`);
        }

        return {
            serverName: serverName,
            connectionString: connectionStringBuilder,
            sqlFile: sqlFilePath,
            actionType: ActionType.SqlAction,
            additionalArguments: additionalArguments
        } as ISqlActionInputs;
    }

    let sqlProjPath = core.getInput('project-file');
    if (!!sqlProjPath) {
        sqlProjPath = AzureSqlActionHelper.resolveFilePath(sqlProjPath);
        if (path.extname(sqlProjPath).toLowerCase() !== Constants.sqlprojExtension) {
            throw new Error(`Invalid database project file path provided as input ${sqlProjPath}`);
        }

        const buildArguments = core.getInput('build-arguments');
        return {
            serverName: serverName,
            connectionString: connectionStringBuilder,
            actionType: ActionType.BuildAndPublish,
            additionalArguments: additionalArguments,
            projectFile: sqlProjPath,
            buildArguments: buildArguments
        } as IBuildAndPublishInputs;
    }
  
    throw new Error('Required SQL file, DACPAC package, or database project file to execute action.');
}

run();
