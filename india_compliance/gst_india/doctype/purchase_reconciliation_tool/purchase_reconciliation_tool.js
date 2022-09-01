// Copyright (c) 2022, Resilient Tech and contributors
// For license information, please see license.txt

// TODO: change the namespace
// TODO: replace the demo data
frappe.provide("reco_tool");

const tooltip_info = {
    purchase_period: "Returns purchases during this period where no match is found.",
    inward_supply_period:
        "Returns all documents from GSTR 2A/2B during this return period.",
};

const api_enabled = ic.is_api_enabled();

const ReturnType = {
    GSTR2A: "GSTR2a",
    GSTR2B: "GSTR2b",
};

frappe.ui.form.on("Purchase Reconciliation Tool", {
    async setup(frm) {
        patch_set_active_tab(frm);
        new ic.quick_info_popover(frm, tooltip_info);

        await frappe.require("purchase_reco_tool.bundle.js");
        frm.purchase_reconciliation_tool = new PurchaseReconciliationTool(frm);

        frm.trigger("set_default_financial_year");
    },

    async company(frm) {
        if (frm.doc.company) {
            const options = await set_gstin_options(frm);
            frm.set_value("company_gstin", options[0]);
        }
    },

    refresh(frm) {
        // allow save for even  for no changes to the form

        fetch_date_range(frm, "purchase");
        fetch_date_range(frm, "inward_supply");

        api_enabled
            ? frm.add_custom_button(__("Download"), () => new ImportDialog(frm))
            : frm.add_custom_button(__("Upload"), () => new ImportDialog(frm, false));

        // add custom buttons
        if (!frm.purchase_reconciliation_tool?.data) return;
        if (frm.get_active_tab()?.df.fieldname == "invoice_tab") {
            frm.add_custom_button(
                __("Unlink"),
                () => unlink_documents(frm),
                __("Actions")
            );
            frm.add_custom_button("dropdown-divider", () => { }, __("Actions"));
        }
        ["Accept My Values", "Accept Supplier Values", "Pending", "Ignore"].forEach(
            action =>
                frm.add_custom_button(
                    __(action),
                    () => apply_action(frm, action),
                    __("Actions")
                )
        );
        frm.$wrapper
            .find("[data-label='dropdown-divider']")
            .addClass("dropdown-divider");

        // Export button
        frm.add_custom_button(__("Export"), () => frm.purchase_reconciliation_tool.apply_data_export());
    },

    before_save(frm) {
        frm.doc.__unsaved = true;
    },

    purchase_period(frm) {
        fetch_date_range(frm, "purchase");
    },

    inward_supply_period(frm) {
        fetch_date_range(frm, "inward_supply");
        frm.trigger("set_default_financial_year");
    },

    after_save(frm) {
        frm.purchase_reconciliation_tool.refresh(
            frm.doc.__onload?.reconciliation_data?.data
        );
    },

    async set_default_financial_year(frm) {
        const { message: date_range } = await frm.call("get_date_range", {
            period:
                frm.doc.inward_supply_period == "Previous Financial Year"
                    ? "Previous Financial Year"
                    : "Current Finanical Year",
        });
        frm.current_financial_year = date_range;
    },

    show_progress(frm, type) {
        if (type == "download") {
            frappe.run_serially([
                () => frm.events.update_progress(frm, "update_api_progress"),
                () => frm.events.update_progress(frm, "update_transactions_progress"),
            ]);
        } else if (type == "upload") {
            frm.events.update_progress(frm, "update_transactions_progress");
        }
    },

    update_progress(frm, method) {
        frappe.realtime.on(method, data => {
            const { current_progress } = data;
            const message =
                method == "update_api_progress"
                    ? __("Fetching data from GSTN")
                    : __("Updating Inward Supply for Return Period {0}", [
                        data.return_period,
                    ]);

            frm.dashboard.show_progress(
                "Import GSTR Progress",
                current_progress,
                message
            );
            if (data.is_last_period) {
                frm.flag_last_return_period = data.return_period;
            }
            if (
                current_progress == 100 &&
                method != "update_api_progress" &&
                frm.flag_last_return_period == data.return_period
            ) {
                setTimeout(() => {
                    frm.dashboard.hide();
                    frm.refresh();
                    frm.dashboard.set_headline("Successfully Imported");
                    setTimeout(() => {
                        frm.dashboard.clear_headline();
                    }, 2000);
                    frm.save();
                }, 1000);
            }
        });
    },
});

class PurchaseReconciliationTool {
    constructor(frm) {
        this.init(frm);
        this.render_tab_group();
        this.setup_filter_button();
        this.render_data_tables();
    }

    init(frm) {
        this.frm = frm;
        this.data = [];
        this.filtered_data = this.data;
        this.$wrapper = this.frm.get_field("reconciliation_html").$wrapper;
        this._tabs = ["invoice", "supplier", "summary"];
    }

    refresh(data) {
        if (data) {
            this.data = data;
            this.refresh_filter_fields();
        }

        this.apply_filters(!!data);

        // data unchanged!
        if (this.rendered_data == this.filtered_data) return;

        this._tabs.forEach(tab => {
            this.tabs[`${tab}_tab`].refresh(this[`get_${tab}_data`]());
        });

        this.rendered_data = this.filtered_data;
    }

    render_tab_group() {
        this.tab_group = new frappe.ui.FieldGroup({
            fields: [
                {
                    //hack: for the FieldGroup(Layout) to avoid rendering default "details" tab
                    fieldtype: "Section Break",
                },
                {
                    label: "Match Summary",
                    fieldtype: "Tab Break",
                    fieldname: "summary_tab",
                    active: 1,
                },
                {
                    fieldtype: "HTML",
                    fieldname: "summary_data",
                },
                {
                    label: "Supplier View",
                    fieldtype: "Tab Break",
                    fieldname: "supplier_tab",
                },
                {
                    fieldtype: "HTML",
                    fieldname: "supplier_data",
                },
                {
                    label: "Document View",
                    fieldtype: "Tab Break",
                    fieldname: "invoice_tab",
                },
                {
                    fieldtype: "HTML",
                    fieldname: "invoice_data",
                },
            ],
            body: this.$wrapper,
            frm: this.frm,
        });

        this.tab_group.make();

        // make tabs_dict for easy access
        this.tabs = Object.fromEntries(
            this.tab_group.tabs.map(tab => [tab.df.fieldname, tab])
        );
    }

    setup_filter_button() {
        this.filter_button = $(`<div class="filter-selector">
			<button class="btn btn-default btn-sm filter-button">
				<span class="filter-icon">
					${frappe.utils.icon("filter")}
				</span>
				<span class="button-label hidden-xs">
					${__("Filter")}
				<span>
			</button>
		</div>`).appendTo(this.$wrapper.find(".form-tabs-list"));

        this.filter_group = new ic.FilterGroup({
            doctype: "Purchase Reconciliation Tool",
            filter_button: this.filter_button,
            filter_options: {
                fieldname: "supplier_name",
                filter_fields: this.get_filter_fields(),
            },
            on_change: () => {
                this.refresh();
            },
        });
    }

    get_filter_fields() {
        const fields = [
            {
                label: "Supplier Name",
                fieldname: "supplier_name",
                fieldtype: "Autocomplete",
                options: this.get_autocomplete_options("supplier_name"),
            },
            {
                label: "Supplier GSTIN",
                fieldname: "supplier_gstin",
                fieldtype: "Autocomplete",
                options: this.get_autocomplete_options("supplier_gstin"),
            },
            {
                label: "Match Status",
                fieldname: "isup_match_status",
                fieldtype: "Select",
                options: [
                    "Exact Match",
                    "Suggested Match",
                    "Mismatch",
                    "Manual Match",
                    "Missing in 2A/2B",
                    "Missing in PR",
                ],
            },
            {
                label: "Action",
                fieldname: "isup_action",
                fieldtype: "Select",
                options: [
                    "No Action",
                    "Accept My Values",
                    "Accept Supplier Values",
                    "Ignore",
                    "Pending",
                ],
            },
            {
                label: "Classification",
                fieldname: "isup_classification",
                fieldtype: "Select",
                options: [
                    "B2B",
                    "B2BA",
                    "CDNR",
                    "CDNRA",
                    "ISD",
                    "ISDA",
                    "IMPG",
                    "IMPGSEZ",
                ],
            },
            {
                label: "Is Reverse Charge",
                fieldname: "is_reverse_charge",
                fieldtype: "Check",
            },
        ];

        fields.forEach(field => (field.parent = "Purchase Reconciliation Tool"));
        return fields;
    }

    refresh_filter_fields() {
        this.filter_group.filter_options.filter_fields = this.get_filter_fields();
    }

    get_autocomplete_options(field) {
        const options = [];
        this.data.forEach(row => {
            if (row[field] && !options.includes(row[field])) options.push(row[field]);
        });
        return options;
    }

    apply_filters(force, custom_filter = null) {
        const has_filters = this.filter_group.filters.length > 0 || custom_filter;
        if (!has_filters) {
            this.filters = null;
            this.filtered_data = this.data;
            return;
        }

        let filters = !custom_filter ? this.filter_group.get_filters() : custom_filter;
        if (!force && this.filters === filters) return;

        this.filters = filters;
        this.filtered_data = this.data.filter(row => {
            return filters.every(filter =>
                ic.FILTER_OPERATORS[filter[2]](filter[3] || "", row[filter[1]] || "")
            );
        });
    }

    render_data_tables() {
        this._tabs.forEach(tab => {
            this.tabs[`${tab}_tab`] = new ic.DataTableManager({
                $wrapper: this.tab_group.get_field(`${tab}_data`).$wrapper,
                columns: this[`get_${tab}_columns`](),
                data: this[`get_${tab}_data`](),
                options: {
                    cellHeight: 55,
                },
            });
        });
        this.set_listeners();
    }

    set_listeners() {
        const me = this;
        this.tabs.invoice_tab.$datatable.on("click", ".btn.eye", function (e) {
            const data = me.mapped_invoice_data[$(this).attr("data-name")];
            me.dm = new DetailViewDialog(me.frm, data);
        });
        this.tabs.supplier_tab.$datatable.on("click", ".btn.download", function (e) {
            // Export selected rows to XLSX
            const selected_row = me.supplier_data[$(this).attr("data-name")];
            me.apply_data_export(selected_row);
        });

        this.tabs.supplier_tab.$datatable.on("click", ".btn.envelope", function (e) {
            const data = me.supplier_data[$(this).attr("data-name")];
            me.dm = new EmailDialog(me.frm, data);
        });

        // TODO: add filters on click
        this.tabs.summary_tab.$datatable.on(
            "click",
            ".match-status",
            async function (e) {
                const match_status = $(this).text();
                console.log(match_status);
            }
        );
    }

    get_summary_data() {
        this.summary_data = {};
        this.filtered_data.forEach(row => {
            let new_row = this.summary_data[row.isup_match_status];
            if (!new_row) {
                new_row = this.summary_data[row.isup_match_status] = {
                    isup_match_status: row.isup_match_status,
                    count_isup_docs: 0,
                    count_pur_docs: 0,
                    count_action_taken: 0,
                    total_docs: 0,
                    tax_diff: 0,
                    taxable_value_diff: 0,
                };
            }
            if (row.isup_name) new_row.count_isup_docs += 1;
            if (row.name) new_row.count_pur_docs += 1;
            if (row.isup_action != "No Action") new_row.count_action_taken += 1;
            new_row.total_docs += 1;
            new_row.tax_diff += row.tax_diff || 0;
            new_row.taxable_value_diff += row.taxable_value_diff || 0;
        });
        return Object.values(this.summary_data);
    }

    get_summary_columns() {
        return [
            {
                label: "Match Status",
                fieldname: "isup_match_status",
                width: 200,
                _value: (...args) => `<span class='match-status'>${args[0]}</span>`,
            },
            {
                label: "Count <br>2A/2B Docs",
                fieldname: "count_isup_docs",
                width: 120,
                align: "center",
            },
            {
                label: "Count <br>Purchase Docs",
                fieldname: "count_pur_docs",
                width: 120,
                align: "center",
            },
            {
                label: "Taxable Amount Diff <br>2A/2B - Purchase",
                fieldname: "taxable_value_diff",
                width: 180,
                align: "center",
                _value: (...args) => format_number(args[0]),
            },
            {
                label: "Tax Difference <br>2A/2B - Purchase",
                fieldname: "tax_diff",
                width: 180,
                align: "center",
                _value: (...args) => format_number(args[0]),
            },
            {
                label: "% Action Taken",
                fieldname: "action_taken",
                width: 120,
                align: "center",
                _value: (...args) => {
                    return (
                        roundNumber(
                            (args[2].count_action_taken / args[2].total_docs) * 100,
                            2
                        ) + " %"
                    );
                },
            },
        ];
    }

    get_supplier_data() {
        this.supplier_data = {};
        this.filtered_data.forEach(row => {
            let new_row = this.supplier_data[row.supplier_gstin];
            if (!new_row) {
                new_row = this.supplier_data[row.supplier_gstin] = {
                    supplier_name: row.supplier_name,
                    supplier_gstin: row.supplier_gstin,
                    count_isup_docs: 0,
                    count_pur_docs: 0,
                    count_action_taken: 0,
                    total_docs: 0,
                    tax_diff: 0,
                    taxable_value_diff: 0,
                };
            }
            if (row.isup_name) new_row.count_isup_docs += 1;
            if (row.name) new_row.count_pur_docs += 1;
            if (row.isup_action != "No Action") new_row.count_action_taken += 1;
            new_row.total_docs += 1;
            new_row.tax_diff += row.tax_diff || 0;
            new_row.taxable_value_diff += row.taxable_value_diff || 0;
        });
        return Object.values(this.supplier_data);
    }

    get_supplier_columns() {
        return [
            {
                label: "Supplier Name",
                fieldname: "supplier_name",
                fieldtype: "Link",
                width: 200,
                _value: (value, column, data) => {
                    // if (data && column.field === "supplier_name") {
                    //     column.docfield.link_onclick = `reco_tool.apply_filters(${JSON.stringify(
                    //         {
                    //             tab: "invoice_tab",
                    //             filters: {
                    //                 supplier_name: data.supplier_gstin,
                    //             },
                    //         }
                    //     )})`;
                    // }

                    return `
                            ${data.supplier_name}
                            <br />
                            <span style="font-size: 0.9em">
                                ${data.supplier_gstin || ""}
                            </span>
                        `;
                },
            },
            {
                label: "Count <br>2A/2B Docs",
                fieldname: "count_isup_docs",
                align: "center",
                width: 120,
            },
            {
                label: "Count <br>Purchase Docs",
                fieldname: "count_pur_docs",
                align: "center",
                width: 120,
            },
            {
                label: "Taxable Amount Diff <br>2A/2B - Purchase",
                fieldname: "taxable_value_diff",
                align: "center",
                width: 150,
                _value: (...args) => format_number(args[0]),
            },
            {
                label: "Tax Difference <br>2A/2B - Purchase",
                fieldname: "tax_diff",
                align: "center",
                width: 150,
                _value: (...args) => format_number(args[0]),
            },
            {
                label: "% Action <br>Taken",
                fieldname: "action_taken",
                align: "center",
                width: 120,
                _value: (...args) => {
                    return (
                        roundNumber(
                            (args[2].count_action_taken / args[2].total_docs) * 100,
                            2
                        ) + " %"
                    );
                },
            },
            {
                fieldname: "download",
                fieldtype: "html",
                width: 60,
                _value: (...args) => get_icon(...args, "download"),
            },
            {
                fieldname: "email",
                fieldtype: "html",
                width: 60,
                _value: (...args) => get_icon(...args, "envelope"),
            },
        ];
    }

    get_invoice_data() {
        this.mapped_invoice_data = {};
        this.filtered_data.forEach(row => {
            this.mapped_invoice_data[get_hash(row)] = row;
        });
        return this.filtered_data;
    }

    get_invoice_columns() {
        return [
            {
                fieldname: "view",
                fieldtype: "html",
                width: 60,
                align: "center",
                _value: (...args) => get_icon(...args, "eye"),
            },
            {
                label: "Supplier Name",
                fieldname: "supplier_name",
                width: 150,
                _value: (...args) => {
                    return `${args[2].supplier_name}
                            <br />
                            <span style="font-size: 0.9em">
                                ${args[2].supplier_gstin || ""}
                            </span>`;
                },
            },
            {
                label: "Bill No.",
                fieldname: "bill_no",
            },
            {
                label: "Date",
                fieldname: "bill_date",
            },
            {
                label: "Match Status",
                fieldname: "isup_match_status",
                width: 120,
            },
            {
                label: "Purchase <br>Invoice",
                fieldname: "name",
                fieldtype: "Link",
                doctype: "Purchase Invoice",
                align: "center",
                width: 120,
            },
            {
                label: "GST Inward <br>Supply",
                fieldname: "isup_name",
                fieldtype: "Link",
                doctype: "GST Inward Supply",
                align: "center",
                width: 120,
            },
            {
                fieldname: "taxable_value_diff",
                label: "Taxable Amount Diff <br>2A/2B - Purchase",
                width: 150,
                align: "center",
                _value: (...args) => {
                    return format_number(args[0]);
                },
            },
            {
                label: "Tax Difference <br>2A/2B - Purchase",
                fieldname: "tax_diff",
                width: 120,
                align: "center",
                _value: (...args) => {
                    return format_number(args[0]);
                },
            },
            {
                fieldname: "differences",
                label: "Differences",
                width: 150,
                align: "Left",
            },
            {
                label: "Action",
                fieldname: "isup_action",
            },
        ];
    }

    get_filtered_data(selected_row = null) {
        let supplier_data;

        if (selected_row) {
            const filters = [[this.frm.doctype, 'supplier_gstin', '=', selected_row.supplier_gstin, false]];

            this.apply_filters(true, filters);
            supplier_data = this.supplier_data[selected_row.supplier_gstin];
        } else {
            supplier_data = this.get_supplier_data();
        }

        let filtered_data = Object.assign({},
            {
                'match_summary': this.get_summary_data(),
                'supplier_summary': supplier_data,
                'invoice_summary': this.filtered_data
            }
        );

        return filtered_data;
    }

    apply_data_export(selected_row = null) {
        this.data_to_export = this.get_filtered_data(selected_row);
        let is_download = selected_row ? true : false;

        if (is_download) delete this.data_to_export.supplier_summary;

        // removed onload data to avoid RequestURI too long error
        let doc = this.frm.doc;
        delete doc["__onload"];

        let get_url = "india_compliance.gst_india.doctype.purchase_reconciliation_tool.purchase_reconciliation_tool.export_data_to_xlsx";

        var export_params = () => {
            return {
                data: JSON.stringify(this.data_to_export),
                doc: JSON.stringify(doc),
                download: is_download,
            }
        }
        open_url_post(`/api/method/${get_url}`, export_params());

    }
}

class DetailViewDialog {
    html_fields = [
        "name",
        "bill_no",
        "bill_date",
        "taxable_value",
        "cgst",
        "sgst",
        "igst",
        "cess",
        "is_reverse_charge",
        "place_of_supply",
    ];

    constructor(frm, data) {
        this.frm = frm;
        this.data = data;
        this.prefix = "isup_";

        this.process_data();
        this.init_dialog();
        this.setup_actions();
        this.render_html();
        this.dialog.show();
    }

    process_data() {
        this._data = {};
        if (this.data["name"]) this._process_data("");
        if (this.data["isup_name"]) this._process_data("isup_");

        ["tax_diff", "taxable_value_diff", "supplier_name", "supplier_gstin"].forEach(
            field => this._assign_value(field, this.data, "")
        );
    }

    _process_data(prefix, data) {
        if (!data) data = this.data;

        this.html_fields.forEach(field => {
            this._data[prefix + field] = null;
            if (field == "name")
                this._data[prefix + "link"] = this._get_link(data, prefix);

            if (field == "is_reverse_charge" && data[prefix + "name"]) {
                this._assign_value(field, data, prefix, true);
                return;
            }

            if (data[prefix + "name"]) this._assign_value(field, data, prefix);
        });
    }

    _assign_value(field, source_data, prefix, bool = false) {
        field = prefix + field;
        if (source_data[field] != null) {
            if (bool) this._data[field] = source_data[field] ? "Yes" : "No";
            else this._data[field] = source_data[field];
        }
    }

    init_dialog() {
        this.dialog = new frappe.ui.Dialog({
            title: `Detail View (${this.data.isup_classification})`,
            fields: [
                ...this._get_document_link_fields(),
                {
                    fieldtype: "HTML",
                    fieldname: "supplier_details",
                    options: `<h5>${this._data.supplier_name} (${this._data.supplier_gstin})</h5>`,
                },
                {
                    fieldtype: "HTML",
                    fieldname: "diff_cards",
                },
                {
                    fieldtype: "HTML",
                    fieldname: "detail_table",
                },
            ],
        });
        this.set_link_options();
    }

    _get_document_link_fields() {
        if (this.data.isup_match_status == "Missing in 2A/2B")
            this.missing_doctype = "GST Inward Supply";
        else if (this.data.isup_match_status == "Missing in PR")
            this.missing_doctype = "Purchase Invoice";
        else return [];

        return [
            {
                label: "GSTIN",
                fieldtype: "Data",
                fieldname: "supplier_gstin",
                default: this.data.supplier_gstin,
                onchange: () => this.set_link_options(),
            },
            {
                label: `Link with (${this.missing_doctype}):`,
                fieldtype: "Autocomplete",
                fieldname: "link_with",
                onchange: () => this.refresh_data(),
            },
            {
                fieldtype: "Column Break",
            },
            {
                label: "Date Range",
                fieldtype: "DateRange",
                fieldname: "date_range",
                default: this.frm.current_financial_year,
                onchange: () => this.set_link_options(),
            },
            {
                label: "Show matched options",
                fieldtype: "Check",
                fieldname: "show_matched",
                onchange: () => this.set_link_options(),
            },
            {
                fieldtype: "Section Break",
            },
        ];
    }

    _get_date_range(field_prefix) {
        const from_date_field = field_prefix + "_from_date";
        const to_date_field = field_prefix + "_to_date";

        return [this.frm.doc[from_date_field], this.frm.doc[to_date_field]];
    }

    async set_link_options() {
        if (!this.missing_doctype) return;

        this.filters = {
            supplier_gstin: this.dialog.get_value("supplier_gstin"),
            bill_from_date: this.dialog.get_value("date_range")[0],
            bill_to_date: this.dialog.get_value("date_range")[1],
            show_matched: this.dialog.get_value("show_matched"),
        };

        const { message } = await this.frm.call("get_link_options", {
            doctype: this.missing_doctype,
            filters: this.filters,
        });

        this.dialog.get_field("link_with").set_data(message);
    }

    setup_actions() {
        // determine actions
        let actions = [];
        if (this.data.isup_match_status == "Missing in 2A/2B") actions.push("Link");
        else if (this.data.isup_match_status == "Missing in PR")
            actions.push("Create", "Link", "Pending");
        else
            actions.push(
                "Unlink",
                "Accept My Values",
                "Accept Supplier Values",
                "Pending"
            );

        actions.push("Ignore");

        // setup actions
        actions.forEach(action => {
            this.dialog.add_custom_action(
                action,
                () => {
                    this._apply_custom_action(action);
                    this.dialog.hide();
                },
                `mr-2 ${this._get_button_css(action)}`
            );
        });

        this.dialog.$wrapper
            .find(".btn.btn-secondary.not-grey")
            .removeClass("btn-secondary");
        this.dialog.$wrapper.find(".modal-footer").css("flex-direction", "inherit");
    }

    _apply_custom_action(action) {
        if (action == "Unlink") {
            unlink_documents(this.frm, [this.data]);
        } else if (action == "Link") {
            reco_tool.link_documents(
                this.frm,
                this._data.name,
                this._data.isup_name,
                true
            );
        } else if (action == "Create") {
            create_new_purchase_invoice(
                this.data,
                this.frm.doc.company,
                this.frm.doc.company_gstin
            );
        } else {
            apply_action(this.frm, action, [this.data]);
        }
    }

    _get_button_css(action) {
        if (action == "Unlink") return "btn-danger not-grey";
        if (action == "Pending") return "btn-secondary";
        if (action == "Ignore") return "btn-secondary";
        if (action == "Create") return "btn-primary not-grey";
        if (action == "Link") return "btn-primary not-grey btn-link disabled";
        if (action == "Accept My Values") return "btn-primary not-grey";
        if (action == "Accept Supplier Values") return "btn-primary not-grey";
    }

    toggle_link_btn(disabled) {
        const btn = this.dialog.$wrapper.find(".modal-footer .btn-link");
        if (disabled) btn.addClass("disabled");
        else btn.removeClass("disabled");
    }

    refresh_data() {
        const field = this.dialog.get_field("link_with");
        let row_data = [];
        this.toggle_link_btn(true);
        if (field.value) {
            row_data = field._data.filter(row => row.value == field.value)[0];
            this.toggle_link_btn(false);
        }

        if (this.data.isup_match_status == "Missing in 2A/2B")
            this._process_data("isup_", row_data);
        else this._process_data("", row_data);

        this._data.taxable_value_diff =
            this._data.taxable_value - this._data.isup_taxable_value;

        const taxes = [];
        ["cgst", "sgst", "igst", "cess"].forEach(tax => {
            taxes.push(this._data[tax]);
            if (this._data[`isup_${tax}`]) taxes.push(this._data[`isup_${tax}`] * -1);
        });
        this._data.tax_diff = taxes.reduce((a, b) => a + b, 0);
        this.render_html();
    }

    render_html() {
        this.render_cards();
        this.render_table();
    }

    render_cards() {
        let cards = [
            {
                value: this._data.tax_diff,
                label: "Tax Difference",
                datatype: "Currency",
                currency: frappe.boot.sysdefaults.currency,
                indicator: this._data.tax_diff == 0 ? "text-success" : "text-danger",
            },
            {
                value: this._data.taxable_value_diff,
                label: "Taxable Amount Difference",
                datatype: "Currency",
                currency: frappe.boot.sysdefaults.currency,
                indicator:
                    this._data.taxable_value_diff == 0 ? "text-success" : "text-danger",
            },
        ];

        if (!this._data.name || !this._data.isup_name) cards = [];

        new ic.NumberCardManager({
            $wrapper: this.dialog.fields_dict.diff_cards.$wrapper,
            cards: cards,
        });
    }

    render_table() {
        const detail_table = this.dialog.fields_dict.detail_table;
        detail_table.html(
            frappe.render_template("detail_view_table", {
                data: this._data,
            })
        );
        detail_table.$wrapper.removeClass("not-matched");
        this._set_value_color(detail_table.$wrapper);
    }

    _set_value_color(wrapper) {
        if (!this._data.name || !this._data.isup_name) return;

        ["place_of_supply", "is_reverse_charge"].forEach(field => {
            if (this._data[field] == this._data[this.prefix + field]) return;
            wrapper
                .find(`[data-label='${field}'], [data-label='${this.prefix}${field}']`)
                .addClass("not-matched");
        });
    }

    _get_link(data, prefix) {
        if (!prefix && data.name)
            return frappe.utils.get_form_link("Purchase Invoice", data.name, true);
        else if (prefix && data.isup_name)
            return frappe.utils.get_form_link(
                "GST Inward Supply",
                data.isup_name,
                true
            );
    }
}

class ImportDialog {
    constructor(frm, for_download = true) {
        this.frm = frm;
        this.for_download = for_download;
        this.init_dialog();
        this.dialog.show();
    }

    init_dialog() {
        if (this.for_download) this._init_download_dialog();
        else this._init_upload_dialog();

        this.return_type = this.dialog.get_value("return_type");
        this.fiscal_year = this.dialog.get_value("fiscal_year");
        this.setup_dialog_actions();
        this.fetch_import_history();
    }

    _init_download_dialog() {
        this.dialog = new frappe.ui.Dialog({
            title: __("Download Data from GSTN"),
            fields: [...this.get_gstr_fields(), ...this.get_history_fields()],
        });
    }

    _init_upload_dialog() {
        this.dialog = new frappe.ui.Dialog({
            title: __("Upload Data"),
            fields: [
                ...this.get_gstr_fields(),
                {
                    label: "Period",
                    fieldname: "period",
                    fieldtype: "Data",
                    read_only: 1,
                },
                {
                    fieldtype: "Section Break",
                },
                {
                    label: "Attach File",
                    fieldname: "attach_file",
                    fieldtype: "Attach",
                    description: "Attach .json file here",
                    options: { restrictions: { allowed_file_types: [".json"] } },
                    onchange: () => {
                        const attached_file = this.dialog.get_value("attach_file");
                        if (!attached_file) return;
                        this.update_return_period();
                    },
                },
                ...this.get_history_fields(),
            ],
        });
    }

    setup_dialog_actions() {
        if (this.for_download) {
            if (this.return_type === ReturnType.GSTR2A) {
                this.dialog.$wrapper.find(".btn-secondary").removeClass("hidden");
                this.dialog.set_primary_action(__("Download All"), () => {
                    this.download_gstr(false);
                    this.dialog.hide();
                });
                this.dialog.set_secondary_action_label(__("Download Missing"));
                this.dialog.set_secondary_action(() => {
                    this.download_gstr(true);
                    this.dialog.hide();
                });
            } else if (this.return_type === ReturnType.GSTR2B) {
                this.dialog.$wrapper.find(".btn-secondary").addClass("hidden");
                this.dialog.set_primary_action(__("Download"), () => {
                    this.download_gstr(true);
                    this.dialog.hide();
                });
            }
        } else {
            this.dialog.set_primary_action(__("Upload"), () => {
                const file_path = this.dialog.get_value("attach_file");
                const period = this.dialog.get_value("period");
                if (!file_path) frappe.throw(__("Please select a file first!"));
                if (!period)
                    frappe.throw(
                        __(
                            "Could not fetch period from file, make sure you have selected the correct file!"
                        )
                    );
                this.upload_gstr(period, file_path);
                this.dialog.hide();
            });
        }
    }

    async fetch_import_history() {
        const { message } = await this.frm.call("get_import_history", {
            return_type: this.return_type,
            fiscal_year: this.fiscal_year,
            for_download: this.for_download,
        });

        if (!message) return;
        this.dialog.fields_dict.history.set_value(message);
    }

    async update_return_period() {
        const file_path = this.dialog.get_value("attach_file");
        const { message } = await this.frm.call("get_return_period_from_file", {
            return_type: this.return_type,
            file_path,
        });

        if (!message) {
            this.dialog.get_field("attach_file").clear_attachment();
            frappe.throw(
                __(
                    "Please make sure you have uploaded the correct file. File Uploaded is not for {0}",
                    [return_type]
                )
            );
        }

        await this.dialog.set_value("period", message);
        this.dialog.refresh();
    }

    async download_gstr(only_missing = true, otp = null) {
        let method;
        const args = { fiscal_year: this.fiscal_year, otp };
        if (this.return_type === ReturnType.GSTR2A) {
            method = "download_gstr_2a";
            args.force = !only_missing;
        } else {
            method = "download_gstr_2b";
        }

        this.frm.events.show_progress(this.frm, "download");
        const { message } = await this.frm.call(method, args);
        if (message && message.errorCode == "RETOTPREQUEST") {
            const otp = await ic.get_gstin_otp();
            if (otp) this.download_gstr(only_missing, otp);
            return;
        }
    }

    upload_gstr(period, file_path) {
        this.frm.events.show_progress(this.frm, "upload");
        this.frm.call("upload_gstr", {
            return_type: this.return_type,
            period,
            file_path,
        });
    }

    get_gstr_fields() {
        return [
            {
                label: "GST Return Type",
                fieldname: "return_type",
                fieldtype: "Select",
                default: ReturnType.GSTR2B,
                options: [
                    { label: "GSTR 2A", value: ReturnType.GSTR2A },
                    { label: "GSTR 2B", value: ReturnType.GSTR2B },
                ],
                onchange: () => {
                    this.fetch_import_history();
                    this.setup_dialog_actions();
                    this.return_type = this.dialog.get_value("return_type");
                },
            },
            {
                fieldtype: "Column Break",
            },
            {
                label: "Fiscal Year",
                fieldname: "fiscal_year",
                fieldtype: "Link",
                options: "Fiscal Year",
                default: frappe.defaults.get_default("fiscal_year"),
                get_query() {
                    return {
                        filters: {
                            year_end_date: [">", "2017-06-30"],
                        },
                    };
                },
                onchange: () => {
                    this.fetch_import_history();
                    this.fiscal_year = this.dialog.get_value("fiscal_year");
                },
            },
        ];
    }

    get_history_fields() {
        const label = this.for_download ? "Download History" : "Upload History";

        return [
            { label, fieldtype: "Section Break" },
            { label, fieldname: "history", fieldtype: "HTML" },
        ];
    }
}

class EmailDialog {
    constructor(frm, data) {
        this.frm = frm;
        this.data = data;
        this.get_xlsx_data();
    }

    get_xlsx_data() {
        let export_data = this.frm.purchase_reconciliation_tool.get_filtered_data(this.data);

        frappe.call({
            method: "india_compliance.gst_india.doctype.purchase_reconciliation_tool.purchase_reconciliation_tool.get_xlsx_report",
            args: {
                data: JSON.stringify(export_data),
                doc: JSON.stringify(this.frm.doc),
            },
            callback: (r) => {
                this.prepare_email_args(r.message);
            }
        })
    }

    prepare_email_args(attachment) {
        this.subject = `Reconciliation for ${this.data.supplier_name}-${this.data.supplier_gstin}`;
        this.message = this.get_email_message();
        this.attachment = attachment;

        this.get_recipients().then((recipients) => {
            this.recipients = recipients;
        }).then(() => {
            this.show_email_dialog();
        });
    }

    show_email_dialog() {
        let args = {
            subject: this.subject,
            recipients: this.recipients || [],
            attach_document_print: false,
            message: this.message,
            attachments: this.attachment
        }
        new frappe.views.CommunicationComposer(args);
    }

    get_email_message() {
        const from_date = frappe.datetime.str_to_user(this.frm.doc.inward_supply_from_date);
        const to_date = frappe.datetime.str_to_user(this.frm.doc.inward_supply_to_date);


        let message = "";
        message += `
            Hello,<br><br>We have made purchase reconciliation for the period ${from_date} to ${to_date} for purchases made by ${this.frm.doc.company} from you.<br><br>
            Attached is the sheet for your reference.<br><br>
        `
        return message;
    }

    async get_recipients() {
        let contact_email;

        await frappe.call({
            method: "india_compliance.gst_india.utils.get_party_contact_details",
            args: {
                'party': this.data.supplier_name,
            },
            callback: (r) => {
                contact_email = r.message['contact_email'];
            }
        });

        return contact_email;
    }
}

async function set_default_financial_year(frm) {
    const { message: date_range } = await frm.call("get_date_range", {
        period:
            frm.doc.inward_supply_period == "Previous Financial Year"
                ? "Previous Financial Year"
                : "Current Finanical Year",
    });
    frm.current_financial_year = date_range;
}

async function fetch_date_range(frm, field_prefix) {
    const from_date_field = field_prefix + "_from_date";
    const to_date_field = field_prefix + "_to_date";
    const period = frm.doc[field_prefix + "_period"];
    if (period == "Custom") return;

    const { message } = await frm.call("get_date_range", { period });
    if (!message) return;

    frm.set_value(from_date_field, message[0]);
    frm.set_value(to_date_field, message[1]);
}

function get_icon(value, column, data, icon) {
    /**
     * Returns custom ormated value for the row.
     * @param {string} value        Current value of the row.
     * @param {object} column       All properties of current column
     * @param {object} data         All values in its core form for current row
     * @param {string} icon         Return icon (font-awesome) as the content
     */

    const hash = get_hash(data);
    return `<button class="btn ${icon}" title="hello" data-name="${hash}">
                <i class="fa fa-${icon}"></i>
            </button>`;
}

function get_hash(data) {
    if (data.name || data.isup_name) return data.name + "~" + data.isup_name;
    if (data.supplier_gstin) return data.supplier_gstin;
}

function patch_set_active_tab(frm) {
    const set_active_tab = frm.set_active_tab;
    frm.set_active_tab = function (...args) {
        set_active_tab.apply(this, args);
        frm.refresh();
    };
}

reco_tool.link_documents = async function (frm, pur_name, isup_name, alert = true) {
    if (frm.get_active_tab()?.df.fieldname != "invoice_tab") return;

    // link documents & update data.
    const { message: r } = await frm.call("link_documents", { pur_name, isup_name });
    const reco_tool = frm.purchase_reconciliation_tool;
    const new_data = reco_tool.data.filter(
        row => !(row.name == pur_name || row.isup_name == isup_name)
    );
    new_data.push(...r);

    reco_tool.refresh(new_data);
    if (alert)
        after_successful_action(frm.purchase_reconciliation_tool.tabs.invoice_tab);
};

function unlink_documents(frm, selected_rows) {
    if (frm.get_active_tab()?.df.fieldname != "invoice_tab") return;
    const { invoice_tab } = frm.purchase_reconciliation_tool.tabs;
    if (!selected_rows) selected_rows = invoice_tab.get_checked_items();

    // validate selected rows
    selected_rows.forEach(row => {
        if (row.isup_match_status.includes("Missing"))
            frappe.throw(
                "You have selected rows where no match is available. Please remove them before unlinking."
            );
    });

    // unlink documents & update table
    frm.call("unlink_documents", selected_rows);
    const unlinked_docs = [
        ...get_unlinked_docs(selected_rows),
        ...get_unlinked_docs(selected_rows, true),
    ];
    const reco_tool = frm.purchase_reconciliation_tool;
    const new_data = reco_tool.data.filter(
        row => !has_matching_row(row, selected_rows)
    );
    new_data.push(...unlinked_docs);
    reco_tool.refresh(new_data);
    after_successful_action(invoice_tab);
}

function get_unlinked_docs(selected_rows, isup = false) {
    const fields_to_update = [
        "bill_no",
        "bill_date",
        "place_of_supply",
        "is_reverse_charge",
    ];

    return deepcopy(selected_rows).map(row => {
        if (isup) row.name = null;
        else row.isup_name = null;

        if (isup)
            fields_to_update.forEach(field => {
                row[field] = row[`isup_${field}`];
            });

        row.tax_diff = "";
        row.taxable_value_diff = "";
        row.differences = "";

        if (!(row.isup_action == "Ignore" || (isup && row.isup_action == "Pending")))
            row.isup_action = "No Action";

        if (!isup) row.isup_match_status = "Missing in 2A/2B";
        else row.isup_match_status = "Missing in PR";

        return row;
    });
}

function deepcopy(array) {
    return JSON.parse(JSON.stringify(array));
}

function apply_action(frm, action, selected_rows) {
    const active_tab = frm.get_active_tab()?.df.fieldname;
    if (!active_tab) return;

    const tab = frm.purchase_reconciliation_tool.tabs[active_tab];
    if (!selected_rows) selected_rows = tab.get_checked_items();

    // get affected rows
    const { filtered_data, data } = frm.purchase_reconciliation_tool;
    let affected_rows = get_affected_rows(active_tab, selected_rows, filtered_data);

    // validate affected rows
    if (action.includes("Accept")) {
        let warn = false;
        affected_rows = affected_rows.filter(row => {
            if (row.isup_match_status.includes("Missing")) {
                warn = true;
                return false;
            }
            return true;
        });

        if (warn)
            frappe.msgprint(
                "You can only Accept values where a match is available. Rows where match is missing will be ignored."
            );
    } else if (action != "Ignore") {
        let warn = false;
        affected_rows = affected_rows.filter(row => {
            if (row.isup_match_status == "Missing in 2A/2B") {
                warn = true;
                return false;
            }
            return true;
        });

        if (warn)
            frappe.msgprint(
                "You can only apply <strong>Ignore</strong> action on rows where data is Missing in 2A/2B. These rows will be ignored."
            );
    }

    // update affected rows to backend and frontend
    frm.call("apply_action", { data: affected_rows, action });
    const new_data = data.filter(row => {
        if (has_matching_row(row, affected_rows)) row.isup_action = action;
        return true;
    });

    frm.purchase_reconciliation_tool.refresh(new_data);
    after_successful_action(tab);
}

function after_successful_action(tab) {
    if (tab) tab.clear_checked_items();
    frappe.show_alert({
        message: "Action applied successfully",
        indicator: "green",
    });
}

function has_matching_row(row, array) {
    return array.filter(item => JSON.stringify(item) === JSON.stringify(row)).length;
}

function get_affected_rows(tab, selection, data) {
    if (tab == "invoice_tab") return selection;

    if (tab == "supplier_tab")
        return data.filter(
            inv =>
                selection.filter(row => row.supplier_gstin == inv.supplier_gstin).length
        );

    if (tab == "summary_tab")
        return data.filter(
            inv =>
                selection.filter(row => row.isup_match_status == inv.isup_match_status)
                    .length
        );
}

async function create_new_purchase_invoice(inward_supply, company, company_gstin) {
    if (inward_supply.isup_match_status != "Missing in PR") return;

    const { message: supplier } = await frappe.call({
        method: "india_compliance.gst_india.utils.get_party_for_gstin",
        args: {
            gstin: inward_supply.supplier_gstin,
        },
    });

    let company_address;
    await frappe.model.get_value(
        "Address",
        { gstin: company_gstin, is_your_company_address: 1 },
        "name",
        r => (company_address = r.name)
    );

    await frappe.new_doc("Purchase Invoice");
    const pur_frm = cur_frm;

    pur_frm.doc.bill_no = inward_supply.isup_bill_no;
    pur_frm.doc.bill_date = inward_supply.isup_bill_date;
    pur_frm.doc.is_reverse_charge = inward_supply.isup_is_reverse_charge;

    _set_value(pur_frm, {
        company: company,
        supplier: supplier,
        shipping_address: company_address,
        billing_address: company_address,
    });

    function _set_value(frm, values) {
        for (const key in values) {
            if (values[key] == frm.doc[key]) continue;
            frm.set_value(key, values[key]);
        }
    }

    // validated this on save
    pur_frm._inward_supply = {
        company: company,
        company_gstin: company_gstin,
        isup_name: inward_supply.isup_name,
        supplier_gstin: inward_supply.supplier_gstin,
        bill_no: inward_supply.isup_bill_no,
        bill_date: inward_supply.isup_bill_date,
        is_reverse_charge: inward_supply.isup_is_reverse_charge,
        place_of_supply: inward_supply.isup_place_of_supply,
        cgst: inward_supply.isup_cgst,
        sgst: inward_supply.isup_sgst,
        igst: inward_supply.isup_igst,
        cess: inward_supply.isup_cess,
        taxable_value: inward_supply.isup_taxable_value,
    };
}

async function set_gstin_options(frm) {
    const { query, params } = ic.get_gstin_query(frm.doc.company);
    const { message } = await frappe.call({
        method: query,
        args: params,
    });

    if (!message) return;
    const gstin_field = frm.get_field("company_gstin");
    gstin_field.set_data(message);
    return message;
}

