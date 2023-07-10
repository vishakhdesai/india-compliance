frappe.provide("stride_projects");

frappe.pages["project-dashboard"].on_page_load = function (wrapper) {
    frappe.ui.make_app_page({
        parent: wrapper,
        title: "Project Dashboard",
        single_column: false,
    });

    stride_projects.employee_project_dashboard =
        new stride_projects.EmployeeProjectDashboard(wrapper);
    $(wrapper).bind("show", function () {
        stride_projects.employee_project_dashboard.show();
    });
};

stride_projects.EmployeeProjectDashboard = class EmployeeProjectDashboard {
    constructor(wrapper) {
        this._initialize_properties(wrapper);
        this._find_elements();
        this.set_sidebar_categories();
    }

    _initialize_properties(wrapper) {
        this.wrapper = $(wrapper);
        this.page = wrapper.page;
        this.user = frappe.user_info(frappe.session.user);
        this.chart_widget_list = [];
        this.chart_widget_dict = {};
    }

    _find_elements() {
        this.sidebar = this.wrapper.find(".layout-side-section");
        this.main_section = this.wrapper.find(".layout-main-section").empty();
        this.filters_section = this.wrapper
            .find(".page-head .container")
            .append(
                `<div class="row flex filters mb-3"><div class="col-lg-2 layout-side-section"></div></div>`
            );
    }

    set_sidebar_categories() {
        this.sidebar_categories = ["Tools", "This Week Summary"];
    }

    show() {
        this.setup_header();
        this.setup_sidebar();
        this.render_main_section();
    }

    go_to_section(elementId) {
        const targetElement = document.getElementById(elementId);
        targetElement.scrollIntoView({ behavior: "smooth" });
    }

    setup_header() {
        this.page.set_title(__(this.page.title));
        this.setup_actions();
        this.add_project_filters();
    }

    setup_sidebar() {
        this.sidebar.empty().append(
            frappe.render_template("project_dashboard_sidebar", {
                fullname: this.user.fullname,
                designation: "UX Designer",
            })
        );
        $("#sidebar-notes").on("click", () => {
            this.go_to_section("notes");
        });
        $("#sidebar-assigned-tasks").on("click", () => {
            this.go_to_section("assigned-tasks");
        });
    }

    render_main_section() {
        this.main_section.empty();
        this.main_section.append(frappe.render_template("project_dashboard"));
        this.render_assigned_tasks();
        this.get_project_overview_html();
        this.get_project_info_html();
        this.get_chart_widgets();
        this.render_project_notes();
        this.render_table();
    }

    setup_actions() {
        this.page.add_inner_button(__("View Calendar"), () => {
            frappe.route_options = {
                project: this.project,
                _assign: ["like", `%"${frappe.session.user}"%`],
            };
            frappe.set_route("List", "Project Activity", "Calendar");
        });
        this.page.add_inner_button(
            __("Project Task"),
            () => {
                new stride_projects.TaskQuickEntry(this.project, "", () =>
                    this.reload()
                );
            },
            __("Create")
        );

        this.page.add_inner_button(
            __("Adhoc Task"),
            () => {
                new stride_projects.TaskQuickEntry("", "", () => this.reload(), true);
            },
            __("Create")
        );
        this.page.set_inner_btn_group_as_primary("Create");

        this.wrapper.find(".card-options.project-notes btn").on("click", () => {
            frappe.new_doc("Project Note");
        });
    }

    async add_project_filters() {
        if (this.wrapper.find(".frappe-control").length > 0) return;

        const me = this;
        this.filter = this.page.add_field(
            {
                label: "Project",
                fieldtype: "Autocomplete",
                fieldname: "project",
                options: await this.get_user_projects(),
                default: "All Projects",
                change() {
                    me.set_current_project();
                    me.reload();
                },
            },
            this.filters_section.find(".filters")
        );
        this.set_current_project();
        $(this.filter.wrapper).removeClass("col-md-2").addClass("col-md-3");
    }

    set_current_project() {
        this.project = this.filter.get_value();
        this.is_no_project_selected = false;
        if (this.project === "None") {
            this.project = "";
            this.is_no_project_selected = true;
        } else if (this.project === "All Projects") {
            this.project = "";
        }
    }

    async get_user_projects() {
        let projects = [];
        // await frappe.call({
        //     method: "stride_projects.stride_projects.page.project_dashboard.project_dashboard.get_user_projects",
        //     args: {
        //         user: frappe.session.user,
        //     },
        //     async: false,
        //     callback: function (r) {
        //         if (!r.message) return;
        //         projects = r.message;
        //     },
        // });
        return projects;
    }

    render_assigned_tasks() {
        this._fetch_tasks(tasks => {
            this._handle_task_widget(tasks);
        });
    }

    _fetch_tasks(callback) {
        let project = this.project;
        if (this.is_no_project_selected) project = "None";

        // frappe.call({
        //     method: "stride_projects.stride_projects.page.project_dashboard.project_dashboard.get_assigned_tasks",
        //     args: { project },
        //     callback: function (r) {
        //         if (!r.message) return;
        //         const tasks = r.message;
        //         callback(tasks);
        //     },
        // });
    }

    _handle_task_widget(tasks) {
        const taskWidgetContainer = this.wrapper.find(
            ".row.assigned-tasks .frappe-card"
        );
        const column_object = {
            Draft: {
                name: "Backlog",
                next_action: "ToDo",
                field_name: "backlog",
                tasks: [],
            },
            ToDo: {
                name: "ToDo",
                next_action: "In Progress",
                field_name: "todo",
                tasks: [],
            },
            "In Progress": {
                name: "In Progress",
                next_action: "Done",
                field_name: "in_progress",
                tasks: [],
            },
        };
        this.task_widget_columns = new Map(Object.entries(column_object));
        this.task_sort_options = {
            sort_by: "deadline",
            sort_by_label: __("Deadline"),
            sort_order: "asc",
            options: [
                {
                    label: __("Deadline"),
                    fieldname: "deadline",
                    fieldtype: "Date",
                    data_attribute: "data-deadline",
                },
                {
                    label: __("Priority"),
                    fieldname: "priority",
                    data_attribute: "data-priority",
                },
            ],
        };

        const options = {
            title: "Assigned Tasks",
            container: taskWidgetContainer,
            columns: this.task_widget_columns,
            sort_options: this.task_sort_options,
            tasks,
        };

        if (!this.tasksWidget) {
            this.tasksWidget = new stride_projects.TasksWidget(options);
        } else {
            this.tasksWidget.load_task_widget(options);
        }
    }

    get_project_overview_html() {
        const me = this;
        const project_row = this.wrapper.find(".row.project-overview");
        if (!this.project) return project_row.addClass("hidden");
        // frappe.call({
        //     method: "stride_projects.stride_projects.doctype.project.project.get_all_milestones_html",
        //     args: {
        //         document: this.project,
        //         milestone_dashboard_filter: "",
        //     },
        //     callback: function (r) {
        //         if (!r.message) return;
        //         project_row.removeClass("hidden");
        //         me.wrapper
        //             .find(".chart-wrapper.project-overview")
        //             .empty()
        //             .append(r.message);
        //     },
        // });
    }

    get_project_info_html() {
        const me = this;
        const project_row = this.wrapper.find(".row.project-info");
        if (!this.project) return project_row.addClass("hidden");
        // frappe.call({
        //     method: "stride_projects.stride_projects.doctype.project.project.get_users_html",
        //     args: {
        //         document: this.project,
        //     },
        //     callback: function (r) {
        //         if (!r.message) return;
        //         project_row.removeClass("hidden");
        //         me.wrapper
        //             .find(".project-info.team-info")
        //             .empty()
        //             .append(r.message);
        //     },
        // });
        // frappe.call({
        //     method: "stride_projects.stride_projects.doctype.project.project.get_project_links_html",
        //     args: {
        //         document: this.project,
        //     },
        //     callback: function (r) {
        //         if (!r.message) return;
        //         project_row.removeClass("hidden");
        //         me.wrapper
        //             .find(".project-info.link-info")
        //             .empty()
        //             .append(r.message);
        //     },
        // });
    }

    get_chart_widgets() {
        const charts = [
            {
                chart_name: "Completed Tasks",
                width: "Full",
                container: this.wrapper.find(".project-charts.col-md-8"),
                widget_type: "chart",
            },
            {
                chart_name: "Tasks Breakdown",
                width: "Full",
                container: this.wrapper.find(".project-charts.col-md-4"),
                widget_type: "chart",
            },
        ];

        charts.forEach(chart => {
            let widget = frappe.widget.make_widget({
                ...chart,
                label: chart.chart_name,
                options: {
                    legendRowHeight: 30,
                },
            });

            this.chart_widget_list.push(widget);
            this.chart_widget_dict[chart.chart_name] = widget;
        });

        this.wrapper.find(".row.project-charts").removeClass("hidden");
    }

    refresh_chart_widgets() {
        this.chart_widget_list.forEach(widget => {
            if (!this.project) delete widget.filters.project;
            else widget.filters.project = this.project;

            widget.save_chart_config_for_user({ filters: widget.filters });
            widget.fetch_and_update_chart();
        });
    }

    render_project_notes() {
        const me = this;
        frappe.call({
            method: "india_compliance.project_dashboard.page.project_dashboard.project_dashboard.get_project_notes",
            args: {
                project: this.project,
            },
            callback: function (r) {
                if (!r.message) return;
                const notes = r.message;
                me.NotesWidget = new stride_projects.NotesWidget({
                    container: me.wrapper.find(
                        ".project-notes .notes-wrapper.project-notes"
                    ),
                    notes: notes,
                    project: me.project,
                });
            },
        });
    }

    render_table() {
        const me = this;
        let team_members = [
            {
                fname: "John",
                lname: "Doe",
                image_url: "https://randomuser.me/api/portraits/men/1.jpg",
                allocated_project: 3,
                planned: "2 weeks",
                planned_days: "14",
                actual_days: "10",
                status: "On Track",
                progress: "60",
                details: [
                    {
                        allocated_project: "Project A",
                        planned: "1 week",
                        planned_days: "7",
                        actual_days: "5",
                        status: "On Track",
                        progress: "80",
                    },
                    {
                        allocated_project: "Project B",
                        planned: "1 week",
                        planned_days: "7",
                        actual_days: "5",
                        status: "Off Track",
                        progress: "60",
                    },
                    {
                        allocated_project: "Project C",
                        planned: "1 week",
                        planned_days: "7",
                        actual_days: "5",
                        status: "On Track",
                        progress: "90",
                    },
                ],
            },
            {
                fname: "Jane",
                lname: "Smith",
                image_url: "https://randomuser.me/api/portraits/women/2.jpg",
                allocated_project: 2,
                planned: "3 weeks",
                planned_days: "21",
                actual_days: "18",
                status: "On Track",
                progress: "90",
                details: [
                    {
                        allocated_project: "Project D",
                        planned: "2 weeks",
                        planned_days: "14",
                        actual_days: "12",
                        status: "On Track",
                        progress: "70",
                    },
                    {
                        allocated_project: "Project E",
                        planned: "1 week",
                        planned_days: "7",
                        actual_days: "6",
                        status: "Off Track",
                        progress: "50",
                    },
                ],
            },
            {
                fname: "Michael",
                lname: "Johnson",
                image_url: "https://randomuser.me/api/portraits/men/3.jpg",
                allocated_project: 1,
                planned: "1 week",
                planned_days: "7",
                actual_days: "6",
                status: "On Track",
                progress: "70",
                details: [
                    {
                        allocated_project: "Project F",
                        planned: "1 week",
                        planned_days: "7",
                        actual_days: "6",
                        status: "Off Track",
                        progress: "40",
                    },
                ],
            },
            {
                fname: "Emily",
                lname: "Williams",
                image_url: "https://randomuser.me/api/portraits/women/4.jpg",
                allocated_project: 4,
                planned: "4 weeks",
                planned_days: "28",
                actual_days: "25",
                status: "On Track",
                progress: "94",
                details: [
                    {
                        allocated_project: "Project G",
                        planned: "2 weeks",
                        planned_days: "14",
                        actual_days: "12",
                        status: "On Track",
                        progress: "85",
                    },
                    {
                        allocated_project: "Project H",
                        planned: "1 week",
                        planned_days: "7",
                        actual_days: "6",
                        status: "Off Track",
                        progress: "55",
                    },
                    {
                        allocated_project: "Project I",
                        planned: "1 week",
                        planned_days: "7",
                        actual_days: "6",
                        status: "On Track",
                        progress: "95",
                    },
                ],
            },
        ];
        let data = team_members.map(({ fname, lname, image_url, ...rest }) => {
            let imageComponent = {
                label: fname,
                sublabel: lname,
                image_url: image_url,
            };
            return { image_component: imageComponent, ...rest };
        });
        const columnNames = {
            image_component: "Team Memeber",
            allocated_project: "Allocated Projects",
            planned: "Planned Duration",
            planned_days: "Planned Days",
            actual_days: "Actual Days",
            status: "Status",
            progress: "Progress",
            details: "Details",
        };
        me.TableWidget = new stride_projects.TableWidget({
            container: me.wrapper.find(
                ".project-time-table .time-table-wrapper.project-time-table"
            ),
            data: data,
            columnNamesMap: columnNames,
            imageComponents: ["image_component"], //array of field names with image components
            includeCollapseButton: true, //for accordian
            indicator_pill_fields: {
                status: {
                    colors: {
                        "On Track": "green",
                        "Off Track": "red",
                    },
                },
                // planned_days: {
                //     colors: {
                //         "10": "green",
                //         "20": "red"
                //     }
                // }
            },
            progress_bar: {
                fields: ["progress"],
            },
            // icon_fields: {
            //     progress: {
            //         icon: "star",
            //         colors: { 80: "green", 60: "red" },
            //     },
            // },
        });
    }

    reload() {
        debugger;
        this.get_project_overview_html();
        this.get_project_info_html();
        this.refresh_chart_widgets();
        this.render_assigned_tasks();
        this.render_project_notes();
    }
};

stride_projects.TasksWidget = class TasksWidget {
    PRIORITY = {
        High: {
            name: "High",
            colour: "#cf3636",
            code: 1,
        },
        Medium: {
            name: "Medium",
            colour: "darkgoldenrod",
            code: 2,
        },
        Low: {
            name: "Low",
            colour: "",
            code: 3,
        },
    };

    constructor(opts) {
        $.extend(this, opts);
        this.columns_list = [];
        this.show();
    }

    load_task_widget(opts) {
        $.extend(this, opts);
        this.columns_list = [];
        this.refresh_tasks();
    }

    show() {
        this.setup_title();
        this.setup_sorting();
        this.refresh_tasks();
    }

    refresh_tasks() {
        this.setup_tasks_area();
        this.process_all_tasks();
        this.initialize_task_columns_and_sort_them();
    }

    initialize_task_columns_and_sort_them() {
        this.columns.forEach(column => {
            this.columns_list.push(
                new stride_projects.TaskColumn({
                    container: this.column_container,
                    column,
                })
            );
        });
        this.sort_tasks();
    }

    process_all_tasks() {
        this.tasks.forEach(task => {
            Object.assign(task, {
                created_since: frappe.datetime.comment_when(task.creation),
                expected_time_formatted: this.format_expected_time(task.expected_time),
                priority_colour: this.get_priority_colour(task.priority),
                priority_number: this.get_priority_number(task.priority),
                deadline: frappe.datetime.str_to_user(task.expected_end_date),
            });

            const column = this.columns.get(task.status);
            if (column) {
                task.next_action = column.next_action;
                column.tasks.push(task);
            }
        });
    }

    format_expected_time(expected_time) {
        if (!expected_time) return;
        return seconds_to_duration(expected_time);
    }

    get_priority_colour(priority) {
        return this.PRIORITY[priority].colour;
    }

    get_priority_number(priority) {
        return this.PRIORITY[priority].code;
    }

    setup_title() {
        this.container.prepend(
            `
            <div class="title-area d-flex">
                <h4 class="title">${this.title}</h4>
            </div>
            `
        );
    }

    setup_sorting() {
        const title_area = this.container.find(".title-area");
        title_area.append(
            `<div class="sort-selector justify-content-end ml-auto"></div>`
        );
        this.sort_selector = new frappe.ui.SortSelector({
            parent: title_area.find(".sort-selector"),
            change: (sort_by, sort_order) => {
                this.sort_tasks();
            },
            args: this.sort_options,
        });
    }

    sort_tasks() {
        const { sort_by, sort_order } = this._get_sort_options();
        this.columns_list.forEach(column => {
            column.sort_tasks(sort_by, sort_order, this.sort_selector);
        });
    }

    _get_sort_options() {
        const sort_order = this.container
            .find(".sort-selector .btn.btn-order")
            .attr("data-value");
        const selectedText = this.container
            .find(".sort-selector .sort-selector-button .dropdown-text")
            .text()
            .trim();

        let sort_by;
        this.container
            .find(".sort-selector .sort-selector-button .dropdown-menu .dropdown-item")
            .each(function () {
                if ($(this).text().trim() === selectedText)
                    sort_by = $(this).attr("data-value");
            });

        return { sort_by, sort_order };
    }

    setup_tasks_area() {
        this.container
            .find(".row-wrapper")
            .empty()
            .append(`<div class="row task-widget"></div>`);

        this.column_container = this.container.find(".row.task-widget");
    }
};

stride_projects.TaskColumn = class TaskColumn {
    constructor(opts) {
        this.load_columns(opts);
    }

    load_columns(opts) {
        this.initialize_properties(opts);
        this.show();
        this.setup_actions();
    }

    initialize_properties(opts) {
        $.extend(this, opts);
        this.title = this.column.name;
        this.tasks = this.column.tasks;
        this.task_list = [];
    }

    show() {
        this.append_task_column();
        const column_container = this.get_column_container().empty();
        this.tasks.forEach(task =>
            this.push_new_task_card({ container: column_container, task })
        );
    }

    push_new_task_card(opts) {
        const new_task = new stride_projects.TaskCard(opts);
        this.task_list.push(new_task);
    }

    calculate_total_time() {
        if (!this.tasks.length) return;
        return seconds_to_duration(this._get_total_time());
    }

    _get_total_time() {
        return this.tasks.reduce((total, task) => {
            if (task.expected_time) total += parseInt(task.expected_time);
            return total;
        }, 0);
    }

    append_task_column() {
        const columnData = {
            column_title: this.title,
            total_time: this.calculate_total_time(),
            total_tasks: this.tasks.length,
            status: this.column.field_name,
        };
        const template = frappe.render_template("task_column", columnData);
        return this.container.append(template);
    }

    get_column_container() {
        return this.container.find(
            `.task-column.${this.column.field_name} .column-tasks`
        );
    }

    sort_tasks(sort_by, order, sort_selector) {
        const field = sort_selector.args.options.find(
            option => option.fieldname === sort_by
        );
        const is_date = field.fieldtype === "Date";
        const attribute = field.data_attribute;

        this._sort_tasks(attribute, order, is_date);
        this.setup_actions();
    }

    _sort_tasks(attribute, order, is_date = false) {
        const container = this.get_column_container();
        let items = container.find(".kanban-card");
        items = Array.prototype.slice.call(items);

        items.sort((a, b) => {
            a = a.getAttribute(attribute);
            b = b.getAttribute(attribute);
            if (is_date) {
                a = new Date(a);
                b = new Date(b);
            }

            if (order === "asc") return a > b ? 1 : -1;

            return a < b ? 1 : -1;
        });

        container.empty().append(items);
    }

    setup_actions() {
        const container = this.get_column_container();

        container.find(".kanban-card").on("click", e => {
            const task_name = e.currentTarget.id;
            new stride_projects.TaskQuickEdit(task_name, () =>
                stride_projects.employee_project_dashboard.reload()
            );
        });

        container.find(".kanban-card .btn").on("click", e => {
            e.stopPropagation();
            const task_name = e.currentTarget.id;
            const next_action = e.currentTarget.dataset.nextAction;
            // frappe.call({
            //     method: "stride_projects.stride_projects.page.project_dashboard.project_dashboard.update_task_status",
            //     args: {
            //         task: task_name,
            //         status: next_action,
            //     },
            //     callback: function (r) {
            //         if (!r.message) return;
            //         stride_projects.employee_project_dashboard.reload();
            //     },
            // });
        });
    }
};

stride_projects.TaskCard = class TaskCard {
    constructor(opts) {
        $.extend(this, opts);
        this.append_task_card();
    }

    append_task_card() {
        this.task_container = this.container.append(
            frappe.render_template("task_card", { task: this.task })
        );
    }
};

function seconds_to_duration(total_time) {
    let timeObj = frappe.utils.seconds_to_duration(total_time, {
        hide_days: true,
    });
    return `${timeObj.hours}h ${timeObj.minutes}m`;
}

stride_projects.NotesWidget = class NotesWidget {
    constructor(opts) {
        $.extend(this, opts);
        this.container = this.container.empty();
        this.show();
        this.setup_actions();
    }

    show() {
        this.notes.forEach(note => {
            this.create_note(note);
        });
    }

    create_note(note, prepend) {
        const note_container = this.get_note_container(note, prepend);
        this.style_note(note, note_container);
        this.setup_note_actions(note, note_container);
    }

    setup_note_actions(note, note_container) {
        note_container.on("click", () => {
            frappe.db.get_doc("Project Note", note.name).then(doc => {
                this.update_edited_note(note_container, doc);
            });
        });

        note_container.find(".custom-checkbox").on("click", e => {
            e.stopPropagation();
            this.mark_note_as_completed(note, note_container);
        });
    }

    update_edited_note(note_container, doc) {
        frappe.ui.form.make_quick_entry(
            "Project Note",
            note => this.reload_note(note, note_container),
            null,
            doc
        );
    }

    mark_note_as_completed(note, note_container) {
        frappe.confirm(
            "Are you sure you want to mark this note as completed?",
            () => {
                frappe.call({
                    method: "india_compliance.project_dashboard.page.project_dashboard.project_dashboard.mark_note_as_completed",
                    args: {
                        note_name: note.name,
                    },
                    callback: function (res) {
                        if (res.exc) return;
                        note_container.remove();
                    },
                });
            },
            () => {
                note_container.find(".custom-checkbox").prop("checked", false);
            }
        );
    }

    style_note(note, note_container) {
        let fontColor = frappe.ui.color.get_contrast_color(note.color);
        note_container.css("background-color", note.color);
        note_container.css("color", fontColor);
    }

    get_note_container(note, prepend) {
        if (prepend)
            this.container.prepend(frappe.render_template("note_card", { note: note }));
        else this.container.append(frappe.render_template("note_card", { note: note }));

        return this.container.find(`#${note.name}`);
    }

    reload_note(note, note_container) {
        this.style_note(note, note_container);
        note_container.find(".note-header").text(note.title);
        note_container.find(".note-description").text(note.notes);
        // this.setup_note_actions(note, note_container);
    }

    setup_actions() {
        let me = this;
        $("#add-note").on("click", () => {
            frappe.ui.form.make_quick_entry(
                "Project Note",
                note => {
                    this.create_note(note, true);
                    me.notes.push(note);
                },
                d => {
                    d.set_value("project", me.project);
                }
            );
        });
    }
};

stride_projects.AvatarWidget = class AvatarWidget {
    constructor(opts) {
        $.extend(this, opts);
        this.show();
    }

    show() {
        let avatar = frappe.avatar(
            null,
            "avatar-large",
            this.name,
            this.image_url,
            false,
            false
        );
        this.avatarCell.innerHTML = `
        <td>
          <div class="row pl-1">
            <div class="col-auto">
              ${avatar}
            </div>
            <div class="col d-flex align-items-center">
              <div class="d-flex flex-column">
                <div class="text-left" style="font-size: larger">${this.label}</div>
                <div class="text-left text-muted">${this.sublabel}</div>
              </div>
            </div>
          </div>
        </td>
      `;
    }
};

stride_projects.TableWidget = class TableWidget {
    constructor(opts) {
        $.extend(this, opts);
        this.container = this.container.empty();
        this.table_id = "dynamic-table";
        this.show();
    }

    render_table_skeleton(table_id) {
        return `
          <div class="container">
            <table id="${table_id}" class="table table-borderless table-widget">
            </table>
          </div>
        `;
    }
    getColumnNames() {
        const firstObject = this.data[0];
        const columnNames = Object.keys(firstObject);

        return columnNames;
    }
    show() {
        let columnNames = this.getColumnNames();

        this.container.append(this.render_table_skeleton(this.table_id));

        let table = document.getElementById(this.table_id);

        let thead = document.createElement("thead");
        let headerRow = document.createElement("tr");

        columnNames.forEach(columnName => {
            if (!(this.includeCollapseButton && columnName == "details")) {
                let th = document.createElement("th");
                th.classList.add("text-muted", "text-center", "align-middle");
                th.textContent = this.columnNamesMap[columnName];
                headerRow.appendChild(th);
            }
        });

        thead.appendChild(headerRow);
        table.appendChild(thead);

        let tbody = document.createElement("tbody");

        this.data.forEach(data_row => {
            let row = document.createElement("tr");

            columnNames.forEach(columnName => {
                if (
                    this.imageComponents.length > 0 &&
                    this.imageComponents.includes(columnName)
                ) {
                    let avatarCell = document.createElement("td");
                    avatarCell.classList.add("align-middle", "text-center");
                    let avatarWidget = new stride_projects.AvatarWidget({
                        image_url: data_row.image_component.image_url,
                        label: data_row.image_component.label,
                        sublabel: data_row.image_component.sublabel,
                        avatarCell: avatarCell,
                        name:
                            data_row.image_component.label +
                            data_row.image_component.sublabel,
                    });
                    row.appendChild(avatarCell);
                } else if (columnName !== "details") {
                    this.set_cell_data(columnName, data_row, row);
                }
            });
            let detailRows = [];
            if (
                this.includeCollapseButton &&
                data_row.details &&
                data_row.details.length > 0
            ) {
                this.create_collapse_button(data_row, row);
                data_row.details.forEach(detail => {
                    let detailRow = document.createElement("tr");
                    detailRow.style.backgroundColor = "#161a1f52";
                    detailRow.className = "collapse";
                    detailRow.id = `collapse-${data_row.image_component.label}-${data_row.image_component.sublabel}`;
                    columnNames.forEach(columnName => {
                        this.set_cell_data(columnName, detail, detailRow);
                    });
                    detailRows.push(detailRow);
                });
            }

            tbody.appendChild(row);
            detailRows.forEach(detailRow => {
                tbody.appendChild(detailRow);
            });
        });

        table.appendChild(tbody);
    }

    create_collapse_button(data_row, row) {
        let collapseCell = document.createElement("td");
        collapseCell.classList.add("align-middle", "text-center");
        let collapseButton = document.createElement("button");
        collapseButton.className = "btn btn-secondary change-sign pr-3 pl-3 pt-0 pb-0";
        collapseButton.style.background = "#161a1fcc";
        collapseButton.setAttribute("type", "button");
        collapseButton.setAttribute("data-toggle", "collapse");
        collapseButton.setAttribute(
            "data-target",
            `#collapse-${data_row.image_component.label}-${data_row.image_component.sublabel}`
        );

        collapseButton.addEventListener("click", function () {
            collapseButton.classList.toggle("active");
        });

        collapseCell.appendChild(collapseButton);
        row.appendChild(collapseCell);
    }

    set_cell_data(columnName, data_row, row) {
        let cell = document.createElement("td");
        cell.classList.add("align-middle", "text-center");

        if (
            this.indicator_pill_fields &&
            Object.keys(this.indicator_pill_fields).includes(columnName)
        ) {
            cell.innerHTML = this.render_indicator_pill(
                data_row[columnName],
                this.indicator_pill_fields[columnName].colors[data_row[columnName]] ||
                    "yellow"
            );
        } else if (
            this.progress_bar &&
            this.progress_bar.fields &&
            this.progress_bar.fields.includes(columnName)
        ) {
            cell.innerHTML = this.render_progress_bar(
                parseInt(data_row[columnName]),
                "#161a1f52"
            );
        } else if (
            this.icon_fields &&
            Object.keys(this.icon_fields).includes(columnName)
        ) {
            cell.innerHTML = this.render_icon_text(
                data_row[columnName],
                this.icon_fields[columnName].icon,
                this.icon_fields[columnName].colors[data_row[columnName]] || "yellow"
            );
        } else {
            cell.textContent = data_row[columnName];
        }

        row.appendChild(cell);
    }

    render_indicator_pill(text, color) {
        return `<span class="indicator-pill whitespace-nowrap ${color}"><span>${text}</span></span>`;
    }

    render_progress_bar(progress, backgroundColor) {
        return `
          <div class="row">
            <div class="col-lg-8 p-0">
              <div class="progress" role="progressbar" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100" style="height: 20px; background-color: ${backgroundColor}">
                <div class="progress-bar" style="width: ${progress}%"></div>
              </div>
            </div>
            <div class="col-lg-4 p-0 text-center">
              <small>${progress}%</small>
            </div>
          </div>
        `;
    }

    render_icon_text(text, icon_name, color) {
        return `
          <div style="color: ${color}">
            <i class="fa fa-${icon_name}"></i>
            <span>${text}</span>
          </div>
        `;
    }
};
