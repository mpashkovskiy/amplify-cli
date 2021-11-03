import { DynamoDBCLIInputs, DynamoDBCLIInputsGSIType } from '../service-walkthrough-types/dynamoDB-user-input-types';
import { AmplifyCategories, AmplifySupportedService, CLIInputSchemaValidator, JSONUtilities, pathManager } from 'amplify-cli-core';
import * as fs from 'fs-extra';
import * as path from 'path';

/* Need to move this logic to a base class */

export class DynamoDBInputState {
  _cliInputsFilePath: string; //cli-inputs.json (output) filepath
  _resourceName: string; //user friendly name provided by user
  _category: string; //category of the resource
  _service: string; //AWS service for the resource
  buildFilePath: string;

  constructor(resourceName: string) {
    this._category = AmplifyCategories.STORAGE;
    this._service = AmplifySupportedService.DYNAMODB;
    this._resourceName = resourceName;

    const projectBackendDirPath = pathManager.getBackendDirPath();
    this._cliInputsFilePath = path.resolve(path.join(projectBackendDirPath, AmplifyCategories.STORAGE, resourceName, 'cli-inputs.json'));
    this.buildFilePath = path.resolve(path.join(projectBackendDirPath, AmplifyCategories.STORAGE, resourceName, 'build'));
  }

  public getCliInputPayload(): DynamoDBCLIInputs {
    let cliInputs: DynamoDBCLIInputs;

    // Read cliInputs file if exists
    try {
      cliInputs = JSONUtilities.readJson(this._cliInputsFilePath) as DynamoDBCLIInputs;
    } catch (e) {
      throw new Error('cli-inputs.json file missing from the resource directory');
    }

    return cliInputs;
  }

  public cliInputFileExists(): boolean {
    return fs.existsSync(this._cliInputsFilePath);
  }

  public isCLIInputsValid(cliInputs?: DynamoDBCLIInputs) {
    if (!cliInputs) {
      cliInputs = this.getCliInputPayload();
    }

    const schemaValidator = new CLIInputSchemaValidator(this._service, this._category, 'DynamoDBCLIInputs');
    schemaValidator.validateInput(JSON.stringify(cliInputs));
  }

  public saveCliInputPayload(cliInputs: DynamoDBCLIInputs): void {
    this.isCLIInputsValid(cliInputs);

    fs.ensureDirSync(path.join(pathManager.getBackendDirPath(), this._category, this._resourceName));
    try {
      JSONUtilities.writeJson(this._cliInputsFilePath, cliInputs);
    } catch (e) {
      throw new Error(e);
    }
  }

  public migrate() {
    let cliInputs: DynamoDBCLIInputs;
    const attrReverseMap: any = {
      S: 'string',
      N: 'number',
      B: 'binary',
      BOOL: 'boolean',
      L: 'list',
      M: 'map',
      NULL: null,
      SS: 'string-set',
      NS: 'number-set',
      BS: 'binary-set',
    };

    // migrate the resource to new directory structure if cli-inputs.json is not found for the resource

    const backendDir = pathManager.getBackendDirPath();
    const oldParametersFilepath = path.join(backendDir, 'storage', this._resourceName, 'parameters.json');
    const oldCFNFilepath = path.join(backendDir, 'storage', this._resourceName, `${this._resourceName}-cloudformation-template.json`);
    const oldStorageParamsFilepath = path.join(backendDir, 'storage', this._resourceName, `storage-params.json`);

    const oldParameters: any = JSONUtilities.readJson(oldParametersFilepath, { throwIfNotExist: true });
    const oldCFN: any = JSONUtilities.readJson(oldCFNFilepath, { throwIfNotExist: true });
    const oldStorageParams: any = JSONUtilities.readJson(oldStorageParamsFilepath, { throwIfNotExist: false }) || {};

    const partitionKey = {
      fieldName: oldParameters.partitionKeyName,
      fieldType: attrReverseMap[oldParameters.partitionKeyType],
    };

    let sortKey;

    if (oldParameters.sortKeyName) {
      sortKey = {
        fieldName: oldParameters.sortKeyName,
        fieldType: attrReverseMap[oldParameters.sortKeyType],
      };
    }

    let triggerFunctions = [];

    if (oldStorageParams.triggerFunctions) {
      triggerFunctions = oldStorageParams.triggerFunctions;
    }

    const getType = (attrList: any, attrName: string) => {
      let attrType;

      attrList.forEach((attr: any) => {
        if (attr.AttributeName === attrName) {
          attrType = attrReverseMap[attr.AttributeType];
        }
      });

      return attrType;
    };

    let gsi: DynamoDBCLIInputsGSIType[] = [];

    if (oldCFN?.Resources?.DynamoDBTable?.Properties?.GlobalSecondaryIndexes) {
      oldCFN.Resources.DynamoDBTable.Properties.GlobalSecondaryIndexes.forEach((cfnGSIValue: any) => {
        let gsiValue: any = {};
        (gsiValue.name = cfnGSIValue.IndexName),
          cfnGSIValue.KeySchema.forEach((keySchema: any) => {
            if (keySchema.KeyType === 'HASH') {
              gsiValue.partitionKey = {
                fieldName: keySchema.AttributeName,
                fieldType: getType(oldCFN.Resources.DynamoDBTable.Properties.AttributeDefinitions, keySchema.AttributeName),
              };
            } else {
              gsiValue.sortKey = {
                fieldName: keySchema.AttributeName,
                fieldType: getType(oldCFN.Resources.DynamoDBTable.Properties.AttributeDefinitions, keySchema.AttributeName),
              };
            }
          });
        gsi.push(gsiValue);
      });
    }
    cliInputs = {
      resourceName: this._resourceName,
      tableName: oldParameters.tableName,
      partitionKey,
      sortKey,
      triggerFunctions,
      gsi,
    };

    this.saveCliInputPayload(cliInputs);

    // Remove old files

    if (fs.existsSync(oldCFNFilepath)) {
      fs.removeSync(oldCFNFilepath);
    }
    if (fs.existsSync(oldParametersFilepath)) {
      fs.removeSync(oldParametersFilepath);
    }
    if (fs.existsSync(oldStorageParamsFilepath)) {
      fs.removeSync(oldStorageParamsFilepath);
    }
  }
}