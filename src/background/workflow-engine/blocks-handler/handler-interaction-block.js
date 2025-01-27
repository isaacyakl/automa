import browser from 'webextension-polyfill';
import { objectHasKey } from '@/utils/helper';
import { getBlockConnection } from '../helper';

async function checkAccess(blockName) {
  if (blockName === 'upload-file') {
    const hasFileAccess = await new Promise((resolve) =>
      chrome.extension.isAllowedFileSchemeAccess(resolve)
    );

    if (hasFileAccess) return true;

    throw new Error('no-file-access');
  } else if (blockName === 'clipboard') {
    const hasPermission = await browser.permissions.contains({
      permissions: ['clipboardRead'],
    });

    if (!hasPermission) {
      throw new Error('no-clipboard-acces');
    }
  }

  return true;
}

async function interactionHandler(block, { refData }) {
  await checkAccess(block.name);

  const { executedBlockOnWeb, debugMode } = this.workflow.settings;

  const nextBlockId = getBlockConnection(block);
  const messagePayload = {
    ...block,
    refData,
    debugMode,
    executedBlockOnWeb,
    frameSelector: this.frameSelector,
  };

  try {
    const data = await this._sendMessageToTab(messagePayload, {
      frameId: this.activeTab.frameId || 0,
    });

    if (objectHasKey(block.data, 'dataColumn')) {
      const dontSaveData =
        (block.name === 'forms' && !block.data.getValue) ||
        !block.data.saveData;

      if (dontSaveData) {
        return {
          data,
          nextBlockId,
        };
      }

      const currentColumnType =
        this.columns[block.data.dataColumn]?.type || 'any';
      const insertDataToColumn = (value) => {
        this.addDataToColumn(block.data.dataColumn, value);

        const addExtraRow =
          objectHasKey(block.data, 'extraRowDataColumn') &&
          block.data.addExtraRow;
        if (addExtraRow) {
          this.addDataToColumn(
            block.data.extraRowDataColumn,
            block.data.extraRowValue
          );
        }
      };

      if (Array.isArray(data) && currentColumnType !== 'array') {
        data.forEach((value) => {
          insertDataToColumn(value);
        });
      } else {
        insertDataToColumn(data);
      }
    }

    const isJavascriptBlock = block.name === 'javascript-code';

    if (block.data.assignVariable && !isJavascriptBlock) {
      this.referenceData.variables[block.data.variableName] = data;
    }

    if (isJavascriptBlock) {
      if (data?.variables) {
        Object.keys(data.variables).forEach((varName) => {
          this.referenceData.variables[varName] = data.variables[varName];
        });
      }

      if (data?.columns.insert) {
        const arrData = Array.isArray(data.columns.data)
          ? data.columns.data
          : [data.columns.data];
        this.addDataToColumn(arrData);
      }
    }

    return {
      data,
      nextBlockId,
    };
  } catch (error) {
    error.nextBlockId = nextBlockId;
    error.data = {
      name: block.name,
      selector: block.data.selector,
    };

    throw error;
  }
}

export default interactionHandler;
