# Copyright (c) 2023, Resilient Tech and contributors
# For license information, please see license.txt
from datetime import datetime

import frappe
from frappe.model.document import Document


class GSTINDetail(Document):
    pass


def create_gstin_detail(gstin, status, registration_date, cancelled_date):
    gstin_exists = frappe.db.exists("GSTIN Detail", gstin)
    gstin_detail = {
        "status": status,
        "registration_date": registration_date,
        "last_updated_on": datetime.now(),
        "cancelled_date": cancelled_date,
    }

    if gstin_exists:
        frappe.get_doc("GSTIN Detail", gstin).update(gstin_detail).save()
    else:
        gstin_detail["doctype"] = "GSTIN Detail"
        gstin_detail["gstin"] = gstin
        frappe.get_doc(gstin_detail).insert()


@frappe.whitelist()
def get_gstin_status(gstin):
    return frappe.get_value("GSTIN Detail", gstin, "status")